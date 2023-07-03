import {
    Transform,
    TransformCallback,
    TransformOptions
} from 'stream'
import {
    IAppConfig,
    TFLunaCommandHeader,
    TFLunaMeasureHeader,
    TFLunaRestoreDefaultSettingsCommand,
    TFLunaSaveCurrentSettingsCommand,
    TFLunaSetBaudRateCommand,
    TFLunaSetSampleRateCommand,
    TFLunaGetVersionCommand,
    TFLunaMeasurementCommand,
    ITFLunaRestoreDefaultSettingsResponse,
    ITFLunaSaveCurrentSettingsResponse,
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaMeasureResponse,
    ITFLunaVersionResponse,
} from '../models/carportTypes';

const ModuleName = 'TFLunaResponseParser';

export interface TFLunaResponseOptions extends TransformOptions {
    app: IAppConfig;
}

export class TFLunaResponseParser extends Transform {
    app: IAppConfig;
    buffer: Buffer;

    constructor({ app, ...options }: TFLunaResponseOptions) {
        super(options);

        this.app = app;
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
            if (Buffer.compare(data.subarray(0, 1), Buffer.from(TFLunaCommandHeader)) === 0) {
                header = data.readUInt8(0);
                length = data.readUInt8(1);
                commandId = data.readUInt8(2);
                checksum = data.readUInt8(data.length - 1);

                this.app.log([ModuleName, 'debug'], `hdr: ${header}, len: ${length}, cmd: ${commandId}, chk: ${checksum}`);

                switch (commandId) {
                    case TFLunaRestoreDefaultSettingsCommand:
                        tfResponse = this.parseRestoreDefaultSettingsResponse(commandId, data);
                        break;

                    case TFLunaSaveCurrentSettingsCommand:
                        tfResponse = this.parseSaveCurrentSettingsResponse(commandId, data);
                        break;

                    case TFLunaSetBaudRateCommand:
                        tfResponse = this.parseSetBaudRateResponse(commandId, data);
                        break;

                    case TFLunaSetSampleRateCommand:
                        tfResponse = this.parseSetSampleRateResponse(commandId, data);
                        break;

                    case TFLunaGetVersionCommand:
                        tfResponse = this.parseGetVersionResponse(commandId, data);
                        break;

                    default:
                        this.app.log([ModuleName, 'debug'], `Unknown response data returned: ${commandId}`)
                        break;
                }

                this.push(tfResponse);
                data = data.subarray(length);
            }
            else if (Buffer.compare(data.subarray(0, 2), Buffer.from(TFLunaMeasureHeader)) === 0) {
                header = data.readUInt16BE(0);
                length = 9;
                commandId = TFLunaMeasurementCommand;
                checksum = data.readUInt8(data.length - 1);

                tfResponse = this.parseTriggerResponse(commandId, data);

                this.push(tfResponse);
                data = data.subarray(length);
            }
        }
        else {
            this.app.log([ModuleName, 'debug'], `Parser data less than 2 bytes...`);
        }

        this.buffer = data;

        return cb();
    }

    public _flush(cb: TransformCallback) {
        this.push(this.buffer);
        this.buffer = Buffer.alloc(0);

        return cb();
    }

    private parseRestoreDefaultSettingsResponse(commandId: number, data: Buffer): ITFLunaRestoreDefaultSettingsResponse {
        this.app.log([ModuleName, 'debug'], `Restore default settings status: ${data.readUInt8(3)}`);

        return {
            commandId,
            status: data.readUInt8(3)
        }
    }

    private parseSaveCurrentSettingsResponse(commandId: number, data: Buffer): ITFLunaSaveCurrentSettingsResponse {
        this.app.log([ModuleName, 'debug'], `Save current settings status: ${data.readUInt8(3)}`);

        return {
            commandId,
            status: data.readUInt8(3)
        }
    }

    private parseSetBaudRateResponse(commandId: number, data: Buffer): ITFLunaBaudResponse {
        const baudRate = ((data.readUInt8(6) << 24) + (data.readUInt8(5) << 16)) + ((data.readUInt8(4) << 8) + (data.readUInt8(3)));

        this.app.log([ModuleName, 'debug'], `baudRate: ${baudRate}`);

        return {
            commandId,
            baudRate
        }
    }

    private parseSetSampleRateResponse(commandId: number, data: Buffer): ITFLunaSampleRateResponse {
        this.app.log([ModuleName, 'debug'], `sampleRate: ${data.readUInt16BE(3)}`);

        return {
            commandId,
            sampleRate: data.readUInt16BE(3)
        }
    }

    private parseGetVersionResponse(commandId: number, data: Buffer): ITFLunaVersionResponse {
        const version = `${data.toString('utf8', 21, 23)}.${data.toString('utf8', 24, 26)}.${data.toString('utf8', 27, 29)}`;

        this.app.log([ModuleName, 'debug'], `vers: ${version}`);

        return {
            commandId,
            version
        }
    }

    private parseTriggerResponse(commandId: number, data: Buffer): ITFLunaMeasureResponse {
        const amp = data.readUInt16LE(4);
        const distCm = (amp <= 100 || amp === 65535) ? 0 : data.readUInt16LE(2);
        const tempC = data.readUInt16LE(6);

        return {
            commandId,
            distCm,
            amp,
            tempC: `${(tempC / 8) - 256}C`,
        }
    }
}
