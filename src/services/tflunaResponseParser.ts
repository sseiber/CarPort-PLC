import {
    Transform,
    TransformCallback,
    TransformOptions
} from 'stream'
import { IAppConfig } from '../models/carportTypes';

const ModuleName = 'TFLunaResponseParser';

interface ITFResponse {
    header: string;
    length: number;
    checksum: string;
    commandId: string;
}

interface IBaudResponse extends ITFResponse {
    baudRate: number;
}

interface ISampleRateResponse extends ITFResponse {
    sampleRate: number;
}

interface IVersionResponse extends ITFResponse {
    version: string;
}

interface ITriggerResponse extends ITFResponse {
    distCm: number;
    amp: number;
    tempC: string;
}

export interface TFLunaResponseOptions extends TransformOptions {
    app: IAppConfig;
    infoHeader: Buffer;
    measureHeader: Buffer;
}

export class TFLunaResponseParser extends Transform {
    app: IAppConfig;
    infoHeader: Buffer;
    measureHeader: Buffer
    buffer: Buffer;

    constructor({ app, infoHeader, measureHeader, ...options }: TFLunaResponseOptions) {
        super(options);

        if (infoHeader === undefined) {
            throw new TypeError('"infoHeader" is not a bufferable object');
        }

        if (measureHeader === undefined) {
            throw new TypeError('"measureHeader" is not a bufferable object');
        }

        this.app = app;
        this.infoHeader = infoHeader;
        this.measureHeader = measureHeader;
        this.buffer = Buffer.alloc(0);
    }

    public _transform(chunk: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
        let data = Buffer.concat([this.buffer, chunk]);
        let header;
        let length;
        let commandId;
        let checksum;
        let tfResponse: any = {};

        if (data.length >= 2) {
            if (Buffer.compare(data.subarray(0, 1), this.infoHeader) === 0) {
                header = data.toString('hex', 0, 1).toUpperCase();
                length = data.readUInt8(1);
                commandId = data.toString('hex', 2, 3).toUpperCase();
                checksum = data.toString('hex', data.length - 1).toUpperCase();

                switch (commandId) {
                    case '06':
                        tfResponse = this.parseSetBaudRateResponse(header, length, commandId, checksum, data);
                        break;

                    case '03':
                        tfResponse = this.parseSetSampleRateResponse(header, length, commandId, checksum, data);
                        break;

                    case '14': // get version
                        tfResponse = this.parseGetVersionResponse(header, length, commandId, checksum, data);
                        break;

                    default:
                        this.app.log([ModuleName, 'warning'], `Unknown response data returned, id=${commandId}`)
                        break;
                }

                this.push(tfResponse);
                data = data.subarray(length);
            }
            else if (Buffer.compare(data.subarray(0, 2), this.measureHeader) === 0) {
                header = data.toString('hex', 0, 2).toUpperCase();
                length = 9;
                commandId = 'trigger';
                checksum = data.toString('hex', data.length - 1).toUpperCase();

                tfResponse = this.parseTriggerResponse(header, length, commandId, checksum, data);

                this.push(tfResponse);
                data = data.subarray(length);
            }
        }
        else {
            this.app.log([ModuleName, 'warning'], `Parser data less than 2 bytes...`);
        }

        this.buffer = data;

        return cb();
    }

    public _flush(cb: TransformCallback) {
        this.push(this.buffer);
        this.buffer = Buffer.alloc(0);

        return cb();
    }

    private parseSetBaudRateResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): IBaudResponse {
        const baudRate = ((data.readUInt8(6) << 24) + (data.readUInt8(5) << 16)) + ((data.readUInt8(4) << 8) + (data.readUInt8(3)));

        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, baud: ${baudRate}`);

        return {
            header,
            length,
            checksum,
            commandId,
            baudRate
        }
    }

    private parseSetSampleRateResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ISampleRateResponse {
        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, freq: ${data.readUInt16BE(3)}`);

        return {
            header,
            length,
            checksum,
            commandId,
            sampleRate: data.readUInt16BE(3)
        }
    }

    private parseGetVersionResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): IVersionResponse {
        const version = `${data.toString('utf8', 21, 23)}.${data.toString('utf8', 24, 26)}.${data.toString('utf8', 27, 29)}`;

        this.app.log([ModuleName, 'info'], `hdr: 0x${header}, len: ${length}, cmd: 0x${commandId}, chk: ${checksum}, vers: ${version}`);

        return {
            header,
            length,
            checksum,
            commandId,
            version
        }
    }

    private parseTriggerResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ITriggerResponse {
        const amp = data.readUInt16LE(4);
        const distCm = (amp <= 100 || amp === 65535) ? 0 : data.readUInt16LE(2);
        const tempC = data.readUInt16LE(6);

        return {
            header,
            length,
            checksum,
            commandId,
            distCm,
            amp,
            tempC: `${(tempC / 8) - 256}C`,
        }
    }
}
