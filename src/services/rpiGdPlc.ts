import {
    IAppConfig,
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
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaVersionResponse,
    ITFLunaMeasureResponse,
    TFLunaMeasurementCommand
} from '../models/carportTypes';
import {
    version,
    // @ts-ignore
    Chip,
    // @ts-ignore
    Line,
    available
} from 'node-libgpiod';
import { SerialPort } from 'serialport';
import { TFLunaResponseParser } from './tfLunaResponseParser';
import { sleep } from '../utils';

const ModuleName = 'RpiGdPlc';

export class RpiGdPlc {
    private app: IAppConfig;
    // @ts-ignore
    private bcm2835: Chip;
    private port: SerialPort;
    private tfLunaResponseParser: TFLunaResponseParser;
    private tfRestoreDefaultSettingsStatus: number;
    private tfSaveCurrentSettingsStatus: number;
    private tfLunaCurrentBaudRate: number;
    private tfLunaCurrentSampleRate: number;
    private tfLunaCurrentVersion: string;
    private tfLunaCurrentMeasurement: number;

    constructor(app: IAppConfig) {
        this.app = app;

        this.tfRestoreDefaultSettingsStatus = 0;
        this.tfSaveCurrentSettingsStatus = 0;
        this.tfLunaCurrentBaudRate = 0;
        this.tfLunaCurrentSampleRate = 0;
        this.tfLunaCurrentVersion = '';
        this.tfLunaCurrentMeasurement = 0;
    }

    public async init(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Initialzation`);

        try {
            this.port = await this.openPort('/dev/ttyAMA2', 115200);

            await this.restoreTFLunaSettings();

            // await this.setTFLunaBaudRate(this.app.baudRate);

            // start with sampleRate === 0 to turn off sampling
            await this.setTFLunaSampleRate(0);

            await this.saveTFLunaSettings();

            await this.getTFLunaVersion();
        }
        catch (ex) {
            this.app.log([ModuleName, 'error'], `Error during init: ${ex.message}`);
        }
    }

    public async start(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Startup: libgpiod version: ${version()}, status: ${available() ? 'available' : 'unavailable'}`);

        try {
            if (!available()) {
                this.app.log([ModuleName, 'info'], `node-libgpiod could not connect to GPIO hardware`);
                return;
            }

            await sleep(1000);

            setInterval(async () => {
                await this.getTFLunaMeasurement();
            }, 2500);
        }
        catch (ex) {
            this.app.log([ModuleName, 'error'], `Error during startup: ${ex.message}`);
        }
    }

    private portError(err: Error): void {
        this.app.log([ModuleName, 'error'], `portError: ${err.message}`);
    }

    private portOpen(): void {
        this.app.log([ModuleName, 'info'], `port open`);
    }

    private portClosed(): void {
        this.app.log([ModuleName, 'info'], `port closed`);
    }

    private tfLunaResponseParserHandler(data: any): void {
        const commandId = data?.commandId;
        if (commandId) {
            switch (commandId) {
                case TFLunaRestoreDefaultSettingsCommand:
                    this.tfRestoreDefaultSettingsStatus = (data as ITFLunaRestoreDefaultSettingsResponse).status;

                    this.app.log([ModuleName, 'info'], `Restore default settings response status: ${this.tfRestoreDefaultSettingsStatus}`);
                    break;

                case TFLunaSaveCurrentSettingsCommand:
                    this.tfSaveCurrentSettingsStatus = (data as ITFLunaSaveCurrentSettingsResponse).status;

                    this.app.log([ModuleName, 'info'], `Save current settings response status: ${this.tfSaveCurrentSettingsStatus}`);
                    break;

                case TFLunaSetBaudRateCommand:
                    this.tfLunaCurrentBaudRate = (data as ITFLunaBaudResponse).baudRate;

                    this.app.log([ModuleName, 'info'], `Current baudRate: ${this.tfLunaCurrentBaudRate}`);
                    break;

                case TFLunaSetSampleRateCommand:
                    this.tfLunaCurrentSampleRate = (data as ITFLunaSampleRateResponse).sampleRate;

                    this.app.log([ModuleName, 'info'], `Set sample rate response: ${this.tfLunaCurrentSampleRate}`);
                    break;

                case TFLunaGetVersionCommand:
                    this.tfLunaCurrentVersion = (data as ITFLunaVersionResponse).version;

                    this.app.log([ModuleName, 'info'], `Get current version response: ${this.tfLunaCurrentVersion}`);
                    break;

                case TFLunaMeasurementCommand:
                    this.tfLunaCurrentMeasurement = (data as ITFLunaMeasureResponse).distCm;

                    this.app.log([ModuleName, 'info'], `Get measurement response: ${this.tfLunaCurrentMeasurement}`);
                    break;

                default:
                    this.app.log([ModuleName, 'debug'], `Unknown response command: ${commandId}`)
                    break;
            }
        }
        else {
            this.app.log([ModuleName, 'error'], `Received unknown response data...`);
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
            app: this.app,
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
        this.app.log([ModuleName, 'info'], `Restore default settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaRestoreDefaultSettingsPrefix.concat([0x00])));
    }

    private async saveTFLunaSettings(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Save current settings settings`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSaveCurrentSettingsPrefix.concat([0x00])));
    }

    // @ts-ignore
    private async setTFLunaBaudRate(baudRate: number = 115200): Promise<void> {
        this.app.log([ModuleName, 'info'], `Set baud rate request with value: ${baudRate}`);

        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetBaudRatePrefix.concat([data1, data2, data3, data4, 0x00])));
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<void> {
        this.app.log([ModuleName, 'info'], `Set sample rate request with value: ${sampleRate}`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaSetSampleRatePrefix.concat([sampleRate, 0x00, 0x00])));
    }

    private async getTFLunaVersion(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Get version request`);

        await this.writeTFLunaCommand(Buffer.from(TFLunaGetVersionPrefix.concat([0x00])));
    }

    private async getTFLunaMeasurement(): Promise<void> {
        await this.writeTFLunaCommand(Buffer.from(TFLunaMeasurementPrefix.concat([0x00])));
    }

    private async writeTFLunaCommand(writeData: Buffer): Promise<void> {
        return new Promise(async (resolve, reject) => {
            this.port.write(writeData, async (writeError) => {
                if (writeError) {
                    this.app.log([ModuleName, 'error'], `Serial port write error: ${writeError.message}`);

                    return reject(writeError);
                }

                this.port.drain(async (drainError) => {
                    if (drainError) {
                        this.app.log([ModuleName, 'error'], `Serial port drain error: ${drainError.message}`);

                        return reject(drainError);
                    }

                    await sleep(1000);

                    return resolve();
                });
            });
        });
    }
}
