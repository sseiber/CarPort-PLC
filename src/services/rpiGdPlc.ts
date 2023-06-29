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
import { ResponseParser } from './responseParser';
import { DeferredPromise } from '../utils';

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

            await this.getTFLunaMeasurement();
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

    private parserData(data: Buffer): void {
        if (data.length >= 2) {
            if (data.readUInt8(0) === 0x5A) {
                const header = data.toString('hex', 0, 1).toUpperCase();
                const length = data.readUInt8(1);
                const commandId = data.toString('hex', 2, 3).toUpperCase();
                const checksum = data.toString('hex', data.length - 1).toUpperCase();

                switch (commandId) {
                    case '06': // set baud rate
                        this.parseSetBaudRateResponse(header, length, commandId, checksum, data);
                        break;

                    case '03': // set sample frequency
                        this.parseSetSampleFrequencyResponse(header, length, commandId, checksum, data);
                        break;

                    case '14': // get version
                        this.parseGetVersionResponse(header, length, commandId, checksum, data);
                        break;

                    default:
                        this.app.log([ModuleName, 'warning'], `Unknown response data returned, id=${commandId}`)
                        break;
                }

                this.waitOnWrite.resolve();
            }
            else if (data.readUInt8(0) === 0x59 && data.readUInt8(1) === 0x59) {
                this.parseTriggerResponse(data);
            }
        }
        else {
            this.app.log([ModuleName, 'warning'], `Parser data less than 2 bytes...`);
        }
    }

    private parseSetBaudRateResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): void {
        this.app.log([ModuleName, 'info'], `Set baud rate response:`);

        const baudRate = ((data.readUInt8(6) << 24) + (data.readUInt8(5) << 16)) + ((data.readUInt8(4) << 8) + (data.readUInt8(3)));
        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, baud: ${baudRate}`);
    }

    private parseSetSampleFrequencyResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): void {
        this.app.log([ModuleName, 'info'], `Set sample frequency response:`);

        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, freq: ${data.readUInt16BE(3)}`);
    }

    private parseGetVersionResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): void {
        this.app.log([ModuleName, 'info'], `Get version response:`);

        const version = `${data.toString('utf8', 21, 23)}.${data.toString('utf8', 24, 26)}.${data.toString('utf8', 27, 29)}`;
        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, vers: ${version}`);
    }

    private parseTriggerResponse(data: Buffer): void {
        this.app.log([ModuleName, 'info'], `Trigger response:`);
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

        const parser = port.pipe(new ResponseParser({ header: 0x5A }));
        parser.on('data', this.parserData.bind(this));

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
