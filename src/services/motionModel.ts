import * as ss from 'simple-statistics';

const SAMPLE_SIZE = 4;

export class MotionModel {
    // @ts-expect-error (future calibration setting)
    private closedLimit = 0;
    // @ts-expect-error (future calibration setting)
    private openLimit = 0;
    private maxSlope = 25;
    private jitterSlope = 0.4;
    private motionValue = 'static';
    private samples: number[][];

    constructor(closedLimit: number, openLimit: number, maxSlope: number, jitterSlope: number) {
        this.closedLimit = closedLimit;
        this.openLimit = openLimit;
        this.maxSlope = maxSlope;
        this.jitterSlope = jitterSlope;
        this.samples = [[]];
    }

    public get motion(): string {
        return this.motionValue;
    }

    public input(sample: [number, number]): void {
        this.samples.push(sample);
        if (this.samples.length > SAMPLE_SIZE) {
            this.samples.shift();
        }

        if (this.samples.length >= SAMPLE_SIZE) {
            const lr = ss.linearRegression(this.samples);

            const absSlope = Math.abs(lr.m);
            if (absSlope > this.maxSlope) {
                this.maxSlope = absSlope;
            }

            if (absSlope === 0 || (absSlope > this.jitterSlope && absSlope < this.maxSlope)) {
                this.motionValue = lr.m < 0 ? 'opening' : lr.m > 0 ? 'closing' : 'static';
            }
        }
    }
}
