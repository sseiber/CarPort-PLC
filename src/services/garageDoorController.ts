import { Server } from '@hapi/hapi';
import {
    ObserveTarget,
    ActiveObserveTargets,
    ActiveObserveTargetsDefaults,
    IGarageDoorControllerConfig,
    GPIOState,
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
} from '../models/carportTypes';
import { SerialPort } from 'serialport';
import {
    version as gpioVersion,
    Chip,
    Line,
    available as gpioAvailable
} from 'node-libgpiod';
import { MotionModel } from './motionModel';
import { TFLunaResponseParser } from './tfLunaResponseParser';
import { sleep } from '../utils';

const ModuleName = 'GarageDoorController';

export class GarageDoorController {
    private server: Server;
    private activeObserveTargets: ActiveObserveTargets;
    private moduleName: string;
    private garageDoorId: number;

    private bcm2835: Chip;
    private actuator: Line;
    private downState: Line;
    private upState: Line;

    private garageDoorControllerConfig: IGarageDoorControllerConfig;
    private motionModel: MotionModel;
    private motion = 'static';
    private serialPort: SerialPort;
    private tfLunaResponseParser: TFLunaResponseParser;
    private tfLunaStatus: ITFLunaStatus;

    constructor(server: Server, garageDoorId: number, garageDoorControllerConfig: IGarageDoorControllerConfig) {
        this.server = server;
        this.activeObserveTargets = {
            ...ActiveObserveTargetsDefaults
        };
        this.moduleName = `${ModuleName}-${garageDoorId}`;
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
        this.server.log([this.moduleName, 'info'], `${ModuleName} initialization: libgpiod version: ${gpioVersion()}`);

        try {
            // wait for up to 15 seconds for GPIO to become available.
            // NOTE:
            // this is a mitigation for the kubelet orchestrator which may have not finished
            // terminating a previous version of the container before starting this new instance.
            for (let initCount = 0; initCount < 5 && !gpioAvailable(); initCount++) {
                this.server.log([ModuleName, 'info'], `${ModuleName} gpio is not available, check 1/${initCount + 1}...`);

                await sleep(3000);
            }

            if (!gpioAvailable()) {
                throw new Error('GPIO is not available');
            }

            this.server.log([this.moduleName, 'info'], `${ModuleName} libgpiod is available`);

            this.bcm2835 = new Chip(0);

            this.server.log([this.moduleName, 'info'], `Initializing garage controller GPIO pins`);

            this.actuator = new Line(this.bcm2835, this.garageDoorControllerConfig.actuatorPin);
            this.actuator.requestOutputMode();

            this.downState = new Line(this.bcm2835, this.garageDoorControllerConfig.downStatePin);
            this.downState.requestInputMode();

            this.upState = new Line(this.bcm2835, this.garageDoorControllerConfig.upStatePin);
            this.upState.requestInputMode();

            this.motionModel = new MotionModel(
                this.garageDoorControllerConfig.tfLunaConfig.closedLimit,
                this.garageDoorControllerConfig.tfLunaConfig.openLimit,
                this.garageDoorControllerConfig.motionModelConfig.maxSlope,
                this.garageDoorControllerConfig.motionModelConfig.jitterSlope
            );
            setInterval(() => {
                const motion = this.motionModel.motion;
                if (this.motion !== motion) {
                    this.motion = motion;

                    this.server.log([this.moduleName, 'info'], `Motion change: ${this.motion}`);
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
            this.server.log([this.moduleName, 'error'], `Error during init: ${ex.message}`);
        }
    }

    public async observe(observeTargets: ActiveObserveTargets): Promise<string> {
        this.activeObserveTargets = {
            ...observeTargets
        };

        this.tfLunaResponseParser.observe(this.activeObserveTargets);

        return 'OK';
    }

    public async startTFLunaMeasurement(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `startTFLunaMeasurement start`);

        try {
            await this.setTFLunaSampleRate(this.garageDoorControllerConfig.tfLunaConfig.sampleRate);
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during start measurement: ${ex.message}`);
        }
    }

    public async stopTFLunaMeasurement(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `startTFLunaMeasurement stop`);

        try {
            await this.setTFLunaSampleRate(0);
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during stop measurement: ${ex.message}`);
        }
    }

    public async getTFLunaMeasurement(): Promise<void> {
        if (this.tfLunaStatus.sampleRate === 0) {
            await this.writeTFLunaCommand(Buffer.from(TFLunaMeasurementPrefix.concat([0x00])));
        }
        else {
            this.server.log([this.moduleName, 'info'], `Measurement is already running`);
        }
    }

    public async actuate(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            if (gpioAvailable()) {
                await this.actuateGarageDoor();

                status = GarageDoorStatus.Unknown;
            }
            else {
                this.server.log([this.moduleName, 'info'], `GPIO access is unavailable`);
            }
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during garage door controller actuate control: ${ex.message}`);
        }


        return status;
    }

    public async open(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            if (gpioAvailable()) {
                await this.actuateGarageDoor();

                status = GarageDoorStatus.Unknown;
            }
            else {
                this.server.log([this.moduleName, 'info'], `GPIO access is unavailable`);
            }
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during garage door controller open control: ${ex.message}`);
        }


        return status;
    }

    public async close(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            if (gpioAvailable()) {
                await this.actuateGarageDoor();

                status = GarageDoorStatus.Unknown;
            }
            else {
                this.server.log([this.moduleName, 'info'], `GPIO access is unavailable`);
            }
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during garage door controller close control: ${ex.message}`);
        }

        return status;
    }

    public async check(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        try {
            if (gpioAvailable()) {
                this.server.log([this.moduleName, 'info'], `Reading GPIO value`);

                const valueDown = this.downState.getValue();
                this.server.log([this.moduleName, 'info'], `GPIO pin state ${this.garageDoorControllerConfig.downStatePin} has value ${valueDown}`);

                const valueUp = this.upState.getValue();
                this.server.log([this.moduleName, 'info'], `GPIO pin state ${this.garageDoorControllerConfig.upStatePin} has value ${valueUp}`);

                if (valueDown === GPIOState.LOW) {
                    status = GarageDoorStatus.Closed;
                }
                else if (valueUp === GPIOState.LOW) {
                    status = GarageDoorStatus.Open;
                }
            }
            else {
                this.server.log([this.moduleName, 'info'], `GPIO access is unavailable`);
            }
        }
        catch (ex) {
            this.server.log([this.moduleName, 'error'], `Error during garage door controller check control: ${ex.message}`);
        }

        return status;
    }

    private async actuateGarageDoor(): Promise<void> {
        try {
            this.server.log([this.moduleName, 'info'], `Activating GPIO pin ${this.garageDoorControllerConfig.actuatorPin} for garageDoorId ${this.garageDoorId}`);

            this.actuator.setValue(GPIOState.HIGH);
            await sleep(this.garageDoorControllerConfig.actuatorPulseDurationMs);
            this.actuator.setValue(GPIOState.LOW);
        }
        catch (ex) {
            this.server.log([this.moduleName, 'info'], `Error activating garage door button: ${ex.message}`);
        }
    }

    private portError(err: Error): void {
        this.server.log([this.moduleName, 'error'], `Serialport Error: ${err.message}`);
    }

    private portOpen(): void {
        this.server.log([this.moduleName, 'info'], `Serialport open`);
    }

    private portClosed(): void {
        this.server.log([this.moduleName, 'info'], `Serialport closed`);
    }

    private tfLunaResponseParserHandler(data: ITFLunaResponse): void {
        const commandId = data?.commandId;
        if (commandId) {
            switch (commandId) {
                case TFLunaRestoreDefaultSettingsCommand:
                    this.tfLunaStatus.restoreDefaultSettingsStatus = (data as ITFLunaRestoreDefaultSettingsResponse).status;

                    this.server.log([this.moduleName, 'info'], `Response: restore default settings: ${this.tfLunaStatus.restoreDefaultSettingsStatus}`);
                    break;

                case TFLunaSaveCurrentSettingsCommand:
                    this.tfLunaStatus.saveCurrentSettingsStatus = (data as ITFLunaSaveCurrentSettingsResponse).status;

                    this.server.log([this.moduleName, 'info'], `Response: save current settings: ${this.tfLunaStatus.saveCurrentSettingsStatus}`);
                    break;

                case TFLunaSetBaudRateCommand:
                    this.tfLunaStatus.baudRate = (data as ITFLunaBaudResponse).baudRate;

                    this.server.log([this.moduleName, 'info'], `Response: current baudRate: ${this.tfLunaStatus.baudRate}`);
                    break;

                case TFLunaSetSampleRateCommand:
                    this.tfLunaStatus.sampleRate = (data as ITFLunaSampleRateResponse).sampleRate;

                    this.server.log([this.moduleName, 'info'], `Response: set sample rate: ${this.tfLunaStatus.sampleRate}`);
                    break;

                case TFLunaGetVersionCommand:
                    this.tfLunaStatus.version = (data as ITFLunaVersionResponse).version;

                    this.server.log([this.moduleName, 'info'], `Response: get current version: ${this.tfLunaStatus.version}`);
                    break;

                case TFLunaMeasurementCommand: {
                    const tfLunaResponse = (data as ITFLunaMeasureResponse);
                    this.tfLunaStatus.measurement = tfLunaResponse.distCm;
                    this.motionModel.input([tfLunaResponse.seq, tfLunaResponse.distCm]);

                    if (this.activeObserveTargets[ObserveTarget.Measurements]) {
                        this.server.log([this.moduleName, 'info'], `Response: measurement: ${this.tfLunaStatus.measurement}, motion: ${this.motion}`);
                    }

                    break;
                }

                default:
                    this.server.log([this.moduleName, 'debug'], `Response: unknown response: ${commandId}`);
                    break;
            }
        }
        else {
            this.server.log([this.moduleName, 'error'], `Response: received unknown response data...`);
        }
    }

    private async openPort(device: string, baudRate: number): Promise<SerialPort> {
        const port = new SerialPort({
            path: device,
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            autoOpen: false
        });
        port.on('error', this.portError.bind(this));
        port.on('open', this.portOpen.bind(this));
        port.on('close', this.portClosed.bind(this));

        this.tfLunaResponseParser = port.pipe(new TFLunaResponseParser({
            garageDoorId: this.garageDoorId,
            objectMode: true,
            highWaterMark: 1000
        }));
        this.tfLunaResponseParser.on('data', this.tfLunaResponseParserHandler.bind(this));

        return new Promise((resolve, reject) => {
            port.open((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve(port);
            });
        });
    }

    // @ts-ignore
    private async restoreTFLunaSettings(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Restore default settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaRestoreDefaultSettingsPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async saveTFLunaSettings(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Save current settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSaveCurrentSettingsPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async resetTFLuna(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Soft reset`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSoftResetPrefix.concat([0x00])));

        await sleep(5000);
    }

    private async setTFLunaBaudRate(baudRate = 115200): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Set baud rate request with value: ${baudRate}`);

        /* eslint-disable no-bitwise */
        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;
        /* eslint-enable no-bitwise */

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetBaudRatePrefix.concat([data1, data2, data3, data4, 0x00])));

        await sleep(2000);
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Set sample rate request with value: ${sampleRate}`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetSampleRatePrefix.concat([sampleRate, 0x00, 0x00])));

        await sleep(2000);
    }

    private async getTFLunaVersion(): Promise<void> {
        this.server.log([this.moduleName, 'info'], `Get version request`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaGetVersionPrefix.concat([0x00])));

        await sleep(2000);
    }

    private async writeTFLunaCommand(writeData: Buffer): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                this.serialPort.write(writeData, async (writeError) => {
                    if (writeError) {
                        this.server.log([this.moduleName, 'error'], `Serial port write error: ${writeError.message}`);

                        return reject(writeError);
                    }

                    this.serialPort.drain(async (drainError) => {
                        if (drainError) {
                            this.server.log([this.moduleName, 'error'], `Serial port drain error: ${drainError.message}`);

                            return reject(drainError);
                        }

                        return resolve();
                    });
                });
            });
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `Serial port write error: ${ex.message}`);
        }
    }
}
