import { forget } from './utils';
import { IAppConfig } from './models/carportTypes';
import { RpiGdPlc } from './services/rpiGdPlc';

const app: IAppConfig = {
    sampleFrequencyMs: 1000,
    log: (tags: any, message: any) => {
        const tagsMessage = (tags && Array.isArray(tags)) ? `[${tags.join(', ')}]` : '[]';

        // eslint-disable-next-line no-console
        console.log(`[${new Date().toTimeString()}] [${tagsMessage}] ${message}`);
    }
};

async function start() {
    try {
        const stopServer = async () => {
            process.exit(0);
        };

        process.on('SIGINT', stopServer);
        process.on('SIGTERM', stopServer);

        const rpiPlc = new RpiGdPlc(app);

        await rpiPlc.init();

        await rpiPlc.start();
    }
    catch (ex) {
        // eslint-disable-next-line no-console
        console.log(`['startup', 'error'], 👹 Error starting PLC: ${ex.message}`);
    }
}

forget(start);
