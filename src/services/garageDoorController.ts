import { Server } from '@hapi/hapi';
import {
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
import { TFLunaResponseParser } from './tfLunaResponseParser';
import { version, Chip, Line, available } from 'node-libgpiod';
import { sleep } from '../utils';

const ModuleName = 'GarageDoorController';

export class GarageDoorController {
    private server: Server;
    private garageDoorId: number;

    private gpioAvailable: boolean;
    private bcm2835: Chip;
    private actuater: Line;
    private downState: Line;
    private upState: Line;

    private garageDoorControllerConfig: IGarageDoorControllerConfig;
    private serialPort: SerialPort;
    private tfLunaResponseParser: TFLunaResponseParser;
    private tfLunaStatus: ITFLunaStatus;

    constructor(server: Server, garageDoorId: number, garageDoorControllerConfig: IGarageDoorControllerConfig) {
        this.server = server;
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
        this.server.log([ModuleName, 'info'], `${ModuleName} initialzation: libgpiod version: ${version}, status: ${available() ? 'available' : 'unavailable'}`);

        try {
            this.gpioAvailable = available();
            if (!this.gpioAvailable) {
                throw new Error('GPIO is not available');
            }

            this.bcm2835 = new Chip(0);

            this.server.log([ModuleName, 'info'], `Initializing garage controller GPIO pins`);

            this.actuater = new Line(this.bcm2835, this.garageDoorControllerConfig.actuaterPin);
            this.actuater.requestOutputMode();

            this.downState = new Line(this.bcm2835, this.garageDoorControllerConfig.downStatePin);
            this.downState.requestInputMode();

            this.upState = new Line(this.bcm2835, this.garageDoorControllerConfig.upStatePin);
            this.upState.requestInputMode();

            this.serialPort = await this.openPort(this.garageDoorControllerConfig.tfLunaConfig.tfLunaSerialPort, this.garageDoorControllerConfig.tfLunaConfig.tfLunaBuadRate);

            await this.restoreTFLunaSettings();

            // start with sampleRate === 0 to turn off sampling
            await this.setTFLunaSampleRate(0);

            await this.saveTFLunaSettings();

            await this.getTFLunaVersion();
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `Error during init: ${ex.message}`);
        }
    }

    public async start(): Promise<void> {
        this.server.log([ModuleName, 'info'], `TFLuna start`);

        try {
            await this.setTFLunaSampleRate(this.garageDoorControllerConfig.tfLunaConfig.tfLunaSampleRate);
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `Error during start measurement: ${ex.message}`);
        }
    }

    public async stop(): Promise<void> {
        this.server.log([ModuleName, 'info'], `TFLuna stop`);

        try {
            await this.setTFLunaSampleRate(0);
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `Error during stop measurement: ${ex.message}`);
        }
    }

    public async getTFLunaMeasurement(): Promise<void> {
        await this.writeTFLunaCommand(Buffer.from(TFLunaMeasurementPrefix.concat([0x00])));
    }

    public async actuate(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        if (this.gpioAvailable) {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        else {
            this.server.log([ModuleName, 'info'], `GPIO access is unavailable`);
        }

        return status;
    }

    public async open(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        if (this.gpioAvailable) {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        else {
            this.server.log([ModuleName, 'info'], `GPIO access is unavailable`);
        }

        return status;
    }

    public async close(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        if (this.gpioAvailable) {
            await this.actuateGarageDoor();

            status = GarageDoorStatus.Unknown;
        }
        else {
            this.server.log([ModuleName, 'info'], `GPIO access is unavailable`);
        }

        return status;
    }

    public async check(): Promise<GarageDoorStatus> {
        let status = GarageDoorStatus.Unknown;

        if (this.gpioAvailable) {
            this.server.log([ModuleName, 'info'], `Reading GPIO value`);

            const valueDown = this.downState.getValue();
            this.server.log([ModuleName, 'info'], `GPIO pin state ${this.garageDoorControllerConfig.downStatePin} has value ${valueDown}`);

            const valueUp = this.upState.getValue();
            this.server.log([ModuleName, 'info'], `GPIO pin state ${this.garageDoorControllerConfig.upStatePin} has value ${valueUp}`);

            if (valueDown === GPIOState.LOW) {
                status = GarageDoorStatus.Closed;
            }
            else if (valueUp === GPIOState.LOW) {
                status = GarageDoorStatus.Open;
            }
        }
        else {
            this.server.log([ModuleName, 'info'], `GPIO access is unavailable`);
        }

        return status;
    }

    private async actuateGarageDoor(): Promise<void> {
        try {
            this.server.log([ModuleName, 'info'], `Activating GPIO pin ${this.garageDoorControllerConfig.actuaterPin} for garageDoorId ${this.garageDoorId}`);

            this.actuater.setValue(GPIOState.HIGH);
            await sleep(500);
            this.actuater.setValue(GPIOState.LOW);
        }
        catch (ex) {
            this.server.log([ModuleName, 'info'], `Error activating garage door button: ${ex.message}`);
        }
    }

    private portError(err: Error): void {
        this.server.log([ModuleName, 'error'], `portError: ${err.message}`);
    }

    private portOpen(): void {
        this.server.log([ModuleName, 'info'], `port open`);
    }

    private portClosed(): void {
        this.server.log([ModuleName, 'info'], `port closed`);
    }

    private tfLunaResponseParserHandler(data: ITFLunaResponse): void {
        const commandId = data?.commandId;
        if (commandId) {
            switch (commandId) {
                case TFLunaRestoreDefaultSettingsCommand:
                    this.tfLunaStatus.restoreDefaultSettingsStatus = (data as ITFLunaRestoreDefaultSettingsResponse).status;

                    this.server.log([ModuleName, 'info'], `Restore default settings response status: ${this.tfLunaStatus.restoreDefaultSettingsStatus}`);
                    break;

                case TFLunaSaveCurrentSettingsCommand:
                    this.tfLunaStatus.saveCurrentSettingsStatus = (data as ITFLunaSaveCurrentSettingsResponse).status;

                    this.server.log([ModuleName, 'info'], `Save current settings response status: ${this.tfLunaStatus.saveCurrentSettingsStatus}`);
                    break;

                case TFLunaSetBaudRateCommand:
                    this.tfLunaStatus.baudRate = (data as ITFLunaBaudResponse).baudRate;

                    this.server.log([ModuleName, 'info'], `Current baudRate: ${this.tfLunaStatus.baudRate}`);
                    break;

                case TFLunaSetSampleRateCommand:
                    this.tfLunaStatus.sampleRate = (data as ITFLunaSampleRateResponse).sampleRate;

                    this.server.log([ModuleName, 'info'], `Set sample rate response: ${this.tfLunaStatus.sampleRate}`);
                    break;

                case TFLunaGetVersionCommand:
                    this.tfLunaStatus.version = (data as ITFLunaVersionResponse).version;

                    this.server.log([ModuleName, 'info'], `Get current version response: ${this.tfLunaStatus.version}`);
                    break;

                case TFLunaMeasurementCommand:
                    this.tfLunaStatus.measurement = (data as ITFLunaMeasureResponse).distCm;

                    this.server.log([ModuleName, 'info'], `Get measurement response: ${this.tfLunaStatus.measurement}`);
                    break;

                default:
                    this.server.log([ModuleName, 'debug'], `Unknown response command: ${commandId}`)
                    break;
            }
        }
        else {
            this.server.log([ModuleName, 'error'], `Received unknown response data...`);
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
            logEnabled: this.garageDoorControllerConfig.tfLunaConfig.tfLunaSerialParserLog,
            objectMode: true
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

    private async restoreTFLunaSettings(): Promise<void> {
        this.server.log([ModuleName, 'info'], `Restore default settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaRestoreDefaultSettingsPrefix.concat([0x00])));
    }

    private async saveTFLunaSettings(): Promise<void> {
        this.server.log([ModuleName, 'info'], `Save current settings settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSaveCurrentSettingsPrefix.concat([0x00])));
    }

    // @ts-ignore
    private async setTFLunaBaudRate(baudRate: number = 115200): Promise<void> {
        this.server.log([ModuleName, 'info'], `Set baud rate request with value: ${baudRate}`);

        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetBaudRatePrefix.concat([data1, data2, data3, data4, 0x00])));
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<void> {
        this.server.log([ModuleName, 'info'], `Set sample rate request with value: ${sampleRate}`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetSampleRatePrefix.concat([sampleRate, 0x00, 0x00])));
    }

    private async getTFLunaVersion(): Promise<void> {
        this.server.log([ModuleName, 'info'], `Get version request`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaGetVersionPrefix.concat([0x00])));
    }

    private async writeTFLunaCommand(writeData: Buffer): Promise<void> {
        return new Promise(async (resolve, reject) => {
            this.serialPort.write(writeData, async (writeError) => {
                if (writeError) {
                    this.server.log([ModuleName, 'error'], `Serial port write error: ${writeError.message}`);

                    return reject(writeError);
                }

                this.serialPort.drain(async (drainError) => {
                    if (drainError) {
                        this.server.log([ModuleName, 'error'], `Serial port drain error: ${drainError.message}`);

                        return reject(drainError);
                    }

                    return resolve();
                });
            });
        });
    }
}
