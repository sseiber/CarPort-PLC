import {
    IAppConfig
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
import { TFLunaResponseParser } from './tflunaResponseParser';
import { DeferredPromise, sleep } from '../utils';

const ModuleName = 'RpiGdPlc';

export class RpiGdPlc {
    private app: IAppConfig;
    // @ts-ignore
    private bcm2835: Chip;
    private port: SerialPort;
    private waitOnWrite: DeferredPromise;

    constructor(app: IAppConfig) {
        this.app = app;
        this.waitOnWrite = null;
    }

    public async init(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Initialzation`);

        try {
            this.port = await this.openPort('/dev/serial1', 115200);

            await this.setTFLunaBaudRate(115200);
            await this.setTFLunaSampleRate(0);
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

            await sleep(3000);

            setInterval(async () => {
                await this.getTFLunaMeasurement();
            }, 2000);
        }
        catch (ex) {
            this.app.log([ModuleName, 'error'], `Error during startup: ${ex.message}`);
        }
    }

    private portError(err: Error): void {
        this.app.log([ModuleName, 'error'], `portError: ${err.message}`);
    }

    private async portOpen(): Promise<void> {
        this.app.log([ModuleName, 'info'], `port open`);
    }

    private portParserData(data: any): void {
        this.app.log([ModuleName, 'info'], `TFParse Response`);
        this.app.log([ModuleName, 'info'], JSON.stringify(data, null, 4));

        this.waitOnWrite.resolve();
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

        const tfLunaParser = new TFLunaResponseParser({
            app: this.app,
            infoHeader: Buffer.from([0x5A]),
            measureHeader: Buffer.from([0x59, 0x59]),
            objectMode: true
        });
        const portParser = port.pipe(tfLunaParser);
        portParser.on('data', this.portParserData.bind(this));

        return new Promise((resolve, reject) => {
            port.open((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve(port);
            });
        });
    }

    private async setTFLunaBaudRate(baudRate: number = 115200): Promise<void> {
        this.app.log([ModuleName, 'info'], `Set baud rate request: ${baudRate}`);

        const data1 = (baudRate & 0xFF);
        const data2 = (baudRate & 0xFF00) >> 8;
        const data3 = (baudRate & 0x00FF0000) >> 16;
        const data4 = (baudRate & 0xFF000000) >> 24;

        await this.writeAndDrain(Buffer.from([0x5A, 0x08, 0x06, data1, data2, data3, data4, 0x00]));
    }

    private async setTFLunaSampleRate(sampleRate: number): Promise<void> {
        this.app.log([ModuleName, 'info'], `Set sample frequency request: ${sampleRate}`);

        await this.writeAndDrain(Buffer.from([0x5A, 0x06, 0x03, sampleRate, 0x00, 0x00]));
    }

    private async getTFLunaVersion(): Promise<void> {
        this.app.log([ModuleName, 'info'], `Get version request`);

        await this.writeAndDrain(Buffer.from([0x5A, 0x04, 0x14, 0x00]));
    }

    private async getTFLunaMeasurement(): Promise<void> {
        await this.writeAndDrain(Buffer.from([0x5A, 0x04, 0x04, 0x00]));
    }

    private async writeAndDrain(data: Buffer): Promise<any> {
        this.port.write(data);
        this.port.drain();

        this.waitOnWrite = new DeferredPromise();

        return this.waitOnWrite;
    }
}
