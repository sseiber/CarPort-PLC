import {
    Transform,
    TransformCallback,
    TransformOptions
} from 'stream'
import {
    IAppConfig,
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaMeasureResponse,
    ITFLunaVersionResponse
} from '../models/carportTypes';

const ModuleName = 'TFLunaResponseParser';

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
                header = `0x${data.toString('hex', 0, 1).toUpperCase()}`;
                length = data.readUInt8(1);
                commandId = `0x${data.toString('hex', 2, 3).toUpperCase()}`;
                checksum = `0x${data.toString('hex', data.length - 1).toUpperCase()}`;

                switch (commandId) {
                    case '0x06':
                        tfResponse = this.parseSetBaudRateResponse(header, length, commandId, checksum, data);
                        break;

                    case '0x03':
                        tfResponse = this.parseSetSampleRateResponse(header, length, commandId, checksum, data);
                        break;

                    case '0x14': // get version
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
                header = `0x${data.toString('hex', 0, 2).toUpperCase()}`;
                length = 9;
                commandId = 'trigger';
                checksum = `0x${data.toString('hex', data.length - 1).toUpperCase()}`;

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

    private parseSetBaudRateResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ITFLunaBaudResponse {
        const baudRate = ((data.readUInt8(6) << 24) + (data.readUInt8(5) << 16)) + ((data.readUInt8(4) << 8) + (data.readUInt8(3)));

        this.app.log([ModuleName, 'info'], `hdr: ${header}, len: ${length}, cmd: ${commandId}, chk: ${checksum}, baud: ${baudRate}`);

        return {
            header,
            length,
            checksum,
            commandId,
            baudRate
        }
    }

    private parseSetSampleRateResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ITFLunaSampleRateResponse {
        this.app.log([ModuleName, 'info'], `hdr: ${header}, len: ${length}, cmd: ${commandId}, chk: ${checksum}, freq: ${data.readUInt16BE(3)}`);

        return {
            header,
            length,
            checksum,
            commandId,
            sampleRate: data.readUInt16BE(3)
        }
    }

    private parseGetVersionResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ITFLunaVersionResponse {
        const version = `${data.toString('utf8', 21, 23)}.${data.toString('utf8', 24, 26)}.${data.toString('utf8', 27, 29)}`;

        this.app.log([ModuleName, 'info'], `hdr: ${header}, len: ${length}, cmd: ${commandId}, chk: ${checksum}, vers: ${version}`);

        return {
            header,
            length,
            checksum,
            commandId,
            version
        }
    }

    private parseTriggerResponse(header: string, length: number, commandId: string, checksum: string, data: Buffer): ITFLunaMeasureResponse {
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
