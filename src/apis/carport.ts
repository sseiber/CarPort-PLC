import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseObject, ResponseToolkit } from '@hapi/hapi';
import {
    badRequest as boom_badRequest
} from '@hapi/boom';
import { CarPortService } from '../services/carport';
import { ICarPortServiceRequest, IObserveRequest } from '../models/carportTypes';

export class CarPortRoutes extends RoutePlugin {
    @inject('carportService')
    private carportService: CarPortService;

    @route({
        method: 'POST',
        path: '/api/v1/observe',
        options: {
            tags: ['observe'],
            description: 'Observe'
        }
    })
    public async postObserve(request: Request, h: ResponseToolkit): Promise<ResponseObject> {
        const observeRequest = request.payload as IObserveRequest;
        if (observeRequest.garageDoorId === undefined || !observeRequest.observeTargets) {
            throw boom_badRequest('Request playload is missing required fields');
        }

        try {
            const controlResponse = await this.carportService.observe(observeRequest);

            return h.response(controlResponse).code(201);
        }
        catch (ex) {
            throw boom_badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/process/control',
        options: {
            tags: ['control'],
            description: 'Control'
        }
    })
    public async postProcess(request: Request, h: ResponseToolkit): Promise<ResponseObject> {
        const controlRequest = request.payload as ICarPortServiceRequest;
        if (controlRequest.garageDoorId === undefined || !controlRequest.action) {
            throw boom_badRequest('Request playload is missing required fields');
        }

        try {
            const controlResponse = await this.carportService.control(controlRequest);

            return h.response(controlResponse).code(201);
        }
        catch (ex) {
            throw boom_badRequest(ex.message);
        }
    }
}
