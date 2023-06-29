import {
    Transform,
    TransformCallback,
    TransformOptions
} from 'stream'

export interface ResponseOptions extends TransformOptions {
    header: number;
}

export class ResponseParser extends Transform {
    header: number;
    buffer: Buffer;

    constructor({ header, ...options }: ResponseOptions) {
        super(options);

        if (header === undefined) {
            throw new TypeError('"header" is not a bufferable object');
        }

        this.header = header;
        this.buffer = Buffer.alloc(0);
    }

    _transform(chunk: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
        let data = Buffer.concat([this.buffer, chunk]);

        if (data.length >= 2) {
            const responseLength = data[1];

            if (data[0] === this.header && data.length >= responseLength) {
                this.push(data.subarray(0, data[1]));

                data = data.subarray(responseLength);
            }
        }

        this.buffer = data;

        return cb();
    }

    _flush(cb: TransformCallback) {
        this.push(this.buffer);
        this.buffer = Buffer.alloc(0);

        return cb();
    }
}
