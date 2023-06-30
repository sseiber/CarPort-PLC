import {
    IAppConfig,
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaMeasureResponse,
    ITFLunaVersionResponse
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
import { DeferredPromise, sleep } from '../utils';

const ModuleName = 'RpiGdPlc';

export class RpiGdPlc {
    private app: IAppConfig;
    // @ts-ignore
    private bcm2835: Chip;
    private port: SerialPort;
    private tfLunaResponseParser: TFLunaResponseParser;
    private writePromiseId: number;
    private mapWritePromises: Map<number, DeferredPromise>;

    constructor(app: IAppConfig) {
        this.app = app;
        this.writePromiseId = 0;
        this.mapWritePromises = new Map<number, DeferredPromise>();
    }

    public async init(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Initialzation`);

        try {
            this.port = await this.openPort('/dev/serial1', 115200);

            const baudRateResponse = await this.setTFLunaBaudRate(115200);
            this.app.log([ModuleName, 'info'], JSON.stringify(baudRateResponse, null, 4));

            const sampleRateResponse = await this.setTFLunaSampleRate(0);
            this.app.log([ModuleName, 'info'], JSON.stringify(sampleRateResponse, null, 4));

            const versionResponse = await this.getTFLunaVersion();
            this.app.log([ModuleName, 'info'], JSON.stringify(versionResponse, null, 4));
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

            await sleep(3000);

            setInterval(async () => {
                const measurement = await this.getTFLunaMeasurement();
                this.app.log([ModuleName, 'info'], JSON.stringify(measurement, null, 4));
            }, 2000);
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
            infoHeader: Buffer.from([0x5A]),
            measureHeader: Buffer.from([0x59, 0x59]),
            objectMode: true
        }));

        return new Promise((resolve, reject) => {
            port.open((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve(port);
            });
        });
    }

    private async setTFLunaBaudRate(baudRate: number = 115200): Promise<ITFLunaBaudResponse> {
        this.app.log([ModuleName, 'info'], `Set baud rate request: ${baudRate}`);

        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;

        return this.writeTFLunaCommand(Buffer.from([0x5A, 0x08, 0x06, data1, data2, data3, data4, 0x00]));
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<ITFLunaSampleRateResponse> {
        this.app.log([ModuleName, 'info'], `Set sample frequency request: ${sampleRate}`);

        return this.writeTFLunaCommand(Buffer.from([0x5A, 0x06, 0x03, sampleRate, 0x00, 0x00]));
    }

    private async getTFLunaVersion(): Promise<ITFLunaVersionResponse> {
        this.app.log([ModuleName, 'info'], `Get version request`);

        return this.writeTFLunaCommand(Buffer.from([0x5A, 0x04, 0x14, 0x00]));
    }

    private async getTFLunaMeasurement(): Promise<ITFLunaMeasureResponse> {
        return this.writeTFLunaCommand(Buffer.from([0x5A, 0x04, 0x04, 0x00]));
    }

    private async writeTFLunaCommand(writeData: Buffer): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const writePromiseId = ++this.writePromiseId;
            const writePromise = new DeferredPromise();
            this.mapWritePromises.set(writePromiseId, writePromise);

            setTimeout(() => {
                return writePromise.reject(new Error('Timeout while waiting for TFLuna response'))
            }, 2000);

            this.tfLunaResponseParser.once('data', (responseData: any) => {
                // TODO: Why can't this just be "writePromise" above??
                const resolvedWritePromise = this.mapWritePromises.get(writePromiseId);

                if (resolvedWritePromise) {
                    return resolvedWritePromise.resolve(responseData);
                }
            });

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

                    let parsedResponseData: any = {};

                    try {
                        parsedResponseData = await writePromise.promise
                    }
                    catch (ex) {
                        this.app.log([ModuleName, 'error'], `TFLuna response error: ${ex.message}`);
                    }

                    return resolve(parsedResponseData);
                });
            });
        });
    }
}
