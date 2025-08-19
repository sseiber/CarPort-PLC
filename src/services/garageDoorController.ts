import { FastifyInstance } from 'fastify';
import {
    ObserveTarget,
    ActiveObserveTargets,
    ActiveObserveTargetsDefaults,
    IGarageDoorControllerConfig,
    LowGpioState,
    HighGpioState,
    GarageDoorStatus,
    ITFLunaStatus,
    TFLunaRestoreDefaultSettingsCommand,
    TFLunaRestoreDefaultSettingsPrefix,
    TFLunaSaveCurrentSettingsCommand,
    TFLunaSaveCurrentSettingsPrefix,
    TFLunaSetBaudRateCommand,
    TFLunaSetBaudRatePrefix,
    TFLunaSetSampleRateCommand,
    TFLunaSetSampleRatePrefix,
    TFLunaSoftResetPrefix,
    TFLunaGetVersionCommand,
    TFLunaGetVersionPrefix,
    TFLunaMeasurementPrefix,
    ITFLunaRestoreDefaultSettingsResponse,
    ITFLunaSaveCurrentSettingsResponse,
    ITFLunaResponse,
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaVersionResponse,
    ITFLunaMeasureResponse,
    TFLunaMeasurementCommand
} from '../models/index.js';
import { SerialPort } from 'serialport';
import {
    version as gpioVersion,
    Chip,
    Line
} from 'node-libgpiod';
import { MotionModel } from './motionModel.js';
import { TFLunaResponseParser } from './tfLunaResponseParser.js';
import { sleep } from '../utils/index.js';

const ServiceName = 'GarageDoorController';

export class GarageDoorController {
    public static createGarageDoorController(server: FastifyInstance, garageDoorId: number, garageDoorControllerConfig: IGarageDoorControllerConfig): GarageDoorController {
        const bcm2835 = new Chip(0);
        if (!bcm2835) {
            throw new Error('Failed to initialize BCM2835');
        }

        const actuator = new Line(bcm2835, garageDoorControllerConfig.actuatorPin);
        if (!actuator) {
            throw new Error('Failed to initialize actuator');
        }

        const downState = new Line(bcm2835, garageDoorControllerConfig.downStatePin);
        if (!downState) {
            throw new Error('Failed to initialize downState');
        }

        const upState = new Line(bcm2835, garageDoorControllerConfig.upStatePin);
        if (!upState) {
            throw new Error('Failed to initialize upState');
        }

        const motionModel = new MotionModel(
            garageDoorControllerConfig.tfLunaConfig.closedLimit,
            garageDoorControllerConfig.tfLunaConfig.openLimit,
            garageDoorControllerConfig.motionModelConfig.maxSlope,
            garageDoorControllerConfig.motionModelConfig.jitterSlope
        );
        if (!motionModel) {
            throw new Error('Failed to initialize motionModel');
        }

        return new GarageDoorController(server, bcm2835, actuator, downState, upState, motionModel, garageDoorId, garageDoorControllerConfig);
    }

    private server: FastifyInstance;
    private activeObserveTargets: ActiveObserveTargets;
    private garageDoorId: number;

    private bcm2835: Chip;
    private actuator: Line;
    private downState: Line;
    private upState: Line;

    private garageDoorControllerConfig: IGarageDoorControllerConfig;
    private motionModel: MotionModel;
    private motion = 'static';
    private serialPort: SerialPort | null = null;
    private tfLunaResponseParser: TFLunaResponseParser | null = null;
    private tfLunaStatus: ITFLunaStatus;

    constructor(
        server: FastifyInstance,
        bcm2835: Chip,
        actuator: Line,
        downState: Line,
        upState: Line,
        motionModel: MotionModel,
        garageDoorId: number,
        garageDoorControllerConfig: IGarageDoorControllerConfig
    ) {
        this.server = server;
        this.bcm2835 = bcm2835;
        this.actuator = actuator;
        this.downState = downState;
        this.upState = upState;
        this.motionModel = motionModel;
        this.activeObserveTargets = {
            ...ActiveObserveTargetsDefaults
        };
        this.garageDoorId = garageDoorId;
        this.garageDoorControllerConfig = garageDoorControllerConfig;
        this.tfLunaStatus = {
            restoreDefaultSettingsStatus: 0,
            saveCurrentSettingsStatus: 0,
            baudRate: 0,
            sampleRate: 0,
            version: '0.0.0',
            measurement: 0
        };
    }

    public async init(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `${this.garageDoorId} initialization gpio ${this.bcm2835.name} - libgpiod version: ${gpioVersion}`);

        try {
            this.server.log.info({ tags: [ServiceName] }, `${this.garageDoorId} Initializing garage controller GPIO pins`);

            this.actuator.requestOutputMode();

            this.downState.requestInputMode();

            this.upState.requestInputMode();

            setInterval(() => {
                const motion = this.motionModel.motion;
                if (this.motion !== motion) {
                    this.motion = motion;

                    this.server.log.info({ tags: [ServiceName] }, `${this.garageDoorId} Motion change: ${this.motion}`);
                }
            }, 1000);

            this.serialPort = await this.openPort(this.garageDoorControllerConfig.tfLunaConfig.serialPort, this.garageDoorControllerConfig.tfLunaConfig.baudRate);

            // await this.restoreTFLunaSettings();

            await this.resetTFLuna();

            await this.setTFLunaBaudRate();

            // start with sampleRate === 0 to turn off sampling
            await this.setTFLunaSampleRate(0);

            await this.saveTFLunaSettings();

            await this.getTFLunaVersion();
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `${this.garageDoorId} Error during init: ${(ex as Error).message}`);
        }
    }

    public observe(observeTargets: ActiveObserveTargets): boolean {
        this.activeObserveTargets = {
            ...observeTargets
        };

        if (this.tfLunaResponseParser) {
            this.tfLunaResponseParser.observe(this.activeObserveTargets);
        }

        return true;
    }

    public async startTFLunaMeasurement(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `startTFLunaMeasurement start`);

        try {
            await this.setTFLunaSampleRate(this.garageDoorControllerConfig.tfLunaConfig.sampleRate);
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during start measurement: ${(ex as Error).message}`);
        }
    }

    public async stopTFLunaMeasurement(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `startTFLunaMeasurement stop`);

        try {
            await this.setTFLunaSampleRate(0);
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during stop measurement: ${(ex as Error).message}`);
        }
    }

    public async getTFLunaMeasurement(): Promise<void> {
        if (this.tfLunaStatus.sampleRate === 0) {
            await this.writeTFLunaCommand(Buffer.from(TFLunaMeasurementPrefix.concat([0x00])));
        }
        else {
            this.server.log.info({ tags: [ServiceName] }, `Measurement is already running`);
        }
    }

    public async actuate(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during garage door controller actuate control: ${(ex as Error).message}`);
        }


        return status;
    }

    public async open(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during garage door controller open control: ${(ex as Error).message}`);
        }


        return status;
    }

    public async close(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during garage door controller close control: ${(ex as Error).message}`);
        }

        return status;
    }

    public check(): GarageDoorStatus {
        let status = GarageDoorStatus.Unknown;

        try {
            this.server.log.info({ tags: [ServiceName] }, `Reading GPIO value`);

            const valueDown = this.downState.getValue();
            this.server.log.info({ tags: [ServiceName] }, `GPIO pin state ${this.garageDoorControllerConfig.downStatePin} has value ${valueDown}`);

            const valueUp = this.upState.getValue();
            this.server.log.info({ tags: [ServiceName] }, `GPIO pin state ${this.garageDoorControllerConfig.upStatePin} has value ${valueUp}`);

            if (valueDown === LowGpioState) {
                status = GarageDoorStatus.Closed;
            }
            else if (valueUp === LowGpioState) {
                status = GarageDoorStatus.Open;
            }
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Error during garage door controller check control: ${(ex as Error).message}`);
        }

        return status;
    }

    private async actuateGarageDoor(): Promise<void> {
        try {
            this.server.log.info({ tags: [ServiceName] }, `Activating GPIO pin ${this.garageDoorControllerConfig.actuatorPin} for garageDoorId ${this.garageDoorId}`);

            this.actuator.setValue(HighGpioState);
            await sleep(this.garageDoorControllerConfig.actuatorPulseDurationMs);
            this.actuator.setValue(LowGpioState);
        }
        catch (ex) {
            this.server.log.info({ tags: [ServiceName] }, `Error activating garage door button: ${(ex as Error).message}`);
        }
    }

    private portError(err: Error): void {
        this.server.log.error({ tags: [ServiceName] }, `Serialport Error: ${err.message}`);
    }

    private portOpen(): void {
        this.server.log.info({ tags: [ServiceName] }, `Serialport open`);
    }

    private portClosed(): void {
        this.server.log.info({ tags: [ServiceName] }, `Serialport closed`);
    }

    private tfLunaResponseParserHandler(data: ITFLunaResponse): void {
        const commandId = data?.commandId;
        if (commandId) {
            switch (commandId) {
                case TFLunaRestoreDefaultSettingsCommand:
                    this.tfLunaStatus.restoreDefaultSettingsStatus = (data as ITFLunaRestoreDefaultSettingsResponse).status;

                    this.server.log.info({ tags: [ServiceName] }, `Response: restore default settings: ${this.tfLunaStatus.restoreDefaultSettingsStatus}`);
                    break;

                case TFLunaSaveCurrentSettingsCommand:
                    this.tfLunaStatus.saveCurrentSettingsStatus = (data as ITFLunaSaveCurrentSettingsResponse).status;

                    this.server.log.info({ tags: [ServiceName] }, `Response: save current settings: ${this.tfLunaStatus.saveCurrentSettingsStatus}`);
                    break;

                case TFLunaSetBaudRateCommand:
                    this.tfLunaStatus.baudRate = (data as ITFLunaBaudResponse).baudRate;

                    this.server.log.info({ tags: [ServiceName] }, `Response: current baudRate: ${this.tfLunaStatus.baudRate}`);
                    break;

                case TFLunaSetSampleRateCommand:
                    this.tfLunaStatus.sampleRate = (data as ITFLunaSampleRateResponse).sampleRate;

                    this.server.log.info({ tags: [ServiceName] }, `Response: set sample rate: ${this.tfLunaStatus.sampleRate}`);
                    break;

                case TFLunaGetVersionCommand:
                    this.tfLunaStatus.version = (data as ITFLunaVersionResponse).version;

                    this.server.log.info({ tags: [ServiceName] }, `Response: get current version: ${this.tfLunaStatus.version}`);
                    break;

                case TFLunaMeasurementCommand: {
                    const tfLunaResponse = (data as ITFLunaMeasureResponse);
                    this.tfLunaStatus.measurement = tfLunaResponse.distCm;
                    this.motionModel.input([tfLunaResponse.seq, tfLunaResponse.distCm]);

                    if (this.activeObserveTargets[ObserveTarget.Measurements]) {
                        this.server.log.info({ tags: [ServiceName] }, `Response: measurement: ${this.tfLunaStatus.measurement}, motion: ${this.motion}`);
                    }

                    break;
                }

                default:
                    this.server.log.debug({ tags: [ServiceName] }, `Response: unknown response: ${commandId}`);
                    break;
            }
        }
        else {
            this.server.log.error({ tags: [ServiceName] }, `Response: received unknown response data...`);
        }
    }

    private async openPort(device: string, baudRate: number): Promise<SerialPort> {
        const serialPort = new SerialPort({
            path: device,
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            autoOpen: false
        });

        serialPort.on('error', this.portError.bind(this));
        serialPort.on('open', this.portOpen.bind(this));
        serialPort.on('close', this.portClosed.bind(this));

        this.tfLunaResponseParser = serialPort.pipe<TFLunaResponseParser>(new TFLunaResponseParser({
            garageDoorId: this.garageDoorId,
            objectMode: true,
            highWaterMark: 1000
        }));
        if (!this.tfLunaResponseParser) {
            throw new Error('Failed to create TFLunaResponseParser');
        }

        this.tfLunaResponseParser.on('data', this.tfLunaResponseParserHandler.bind(this));

        return new Promise<SerialPort>((resolve, reject) => {
            serialPort.open((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve(serialPort);
            });
        });
    }

    // @ts-expect-error (future control method)
    private async restoreTFLunaSettings(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Restore default settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaRestoreDefaultSettingsPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async saveTFLunaSettings(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Save current settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSaveCurrentSettingsPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async resetTFLuna(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Soft reset`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSoftResetPrefix.concat([0x00])));

        await sleep(5000);
    }

    private async setTFLunaBaudRate(baudRate = 115200): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Set baud rate request with value: ${baudRate}`);

        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetBaudRatePrefix.concat([data1, data2, data3, data4, 0x00])));

        await sleep(2000);
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Set sample rate request with value: ${sampleRate}`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetSampleRatePrefix.concat([sampleRate, 0x00, 0x00])));

        await sleep(2000);
    }

    private async getTFLunaVersion(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `Get version request`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaGetVersionPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async writeTFLunaCommand(writeData: Buffer): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                this.serialPort?.write(writeData, (writeError) => {
                    if (writeError) {
                        this.server.log.error({ tags: [ServiceName] }, `Serial port write error: ${writeError.message}`);

                        return reject(writeError);
                    }

                    this.serialPort?.drain((drainError) => {
                        if (drainError) {
                            this.server.log.error({ tags: [ServiceName] }, `Serial port drain error: ${drainError.message}`);

                            return reject(drainError);
                        }

                        return resolve();
                    });
                });
            });
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `Serial port write error: ${(ex as Error).message}`);
        }
    }
}
