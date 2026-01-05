import { Get, Post, Body as NestBody, Req, Res, Param, NotFoundException, Type, Request, Put, ParseArrayPipe, Query, Patch, Delete } from '@nestjs/common';
import { EntityData, FilterQuery, MetadataStorage, AnyEntity } from '@mikro-orm/core';
import { ObjectId as MongoObjectId } from 'mongodb';
import { ObjectId } from '@mikro-orm/mongodb';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Transform as CsvTransform } from 'json2csv';
import { Readable } from 'stream';
import { instanceToPlain } from 'class-transformer';
import { BaseService } from '../base.service';
import { EntityNameUtil } from '../utils/entity-name.util';
import { ApiBadRequestResponse, ApiBody, ApiExtraModels, ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiParam, ApiResponse, ApiTags, getSchemaPath, ApiProduces, ApiProperty, ApiQuery } from '@nestjs/swagger';
import { PaginationDto } from '../dto/pagination.dto';
import { CrudOptions } from '../interfaces/crud-options.interface';
import { DtoFactory } from '../utils/dto-factory.util';

export interface ICrudController<T extends AnyEntity> {
  readonly service: BaseService<T>;
}

/**
 * CRUD Decorator
 * Automatically injects CRUD methods into the controller via prototype inheritance.
 */
const Body = <X,>(dto: Type<X> | Type<X>[]) => {
  return (
    target: Object,
    propertyKey: string | symbol,
    parameterIndex: number
  ) => {
    if (Array.isArray(dto)) {
      return NestBody(new ParseArrayPipe({ items: dto[0] }))(target, propertyKey, parameterIndex);
    }
    const metadata = Reflect.getMetadata('design:paramtypes', target, propertyKey);
    if (metadata) {
      const newParamTypes = [...metadata];
      newParamTypes[0] = dto;
      Reflect.defineMetadata('design:paramtypes', newParamTypes, target, propertyKey);
    }
    return NestBody()(target, propertyKey, parameterIndex);
  }
};


import { CRUD_OPTIONS_METADATA, FETCHED_ENTITY_KEY } from '../constants';
import { ApiPropertyUtil } from '../utils/api-property.util';

export function Crud<T extends AnyEntity, C = EntityData<T>, U = EntityData<T>>(options: CrudOptions<T, C, U>) {
  DtoFactory.createDtos(options);
  ApiPropertyUtil.createApiEntity(options.entity);

  let primaryKey = 'id';
  let primaryKeyType: any = String;

  const meta = MetadataStorage.getMetadataFromDecorator(options.entity);

  if (meta && meta.primaryKeys && meta.primaryKeys.length > 0) {
    primaryKey = meta.primaryKeys[0];
    const prop = meta.properties[primaryKey];
    if (prop) {
      // Try to guess type from prop.type or design:type
      if (prop.type === 'ObjectId' || (prop.type as any) === ObjectId || (prop.type as any) === MongoObjectId) {
        primaryKeyType = ObjectId;
      } else if (prop.type === 'number' || prop.type === Number) {
        primaryKeyType = Number;
      } else {
        primaryKeyType = Reflect.getMetadata('design:type', options.entity.prototype, primaryKey) || String;
      }
    }
  }

  const parseId = (id: string) => {
    if (primaryKeyType === ObjectId || primaryKeyType === MongoObjectId) {
      return new MongoObjectId(id);
    }
    if (primaryKeyType === Number) {
      return Number(id);
    }
    return id;
  };

  return function (target: Function) {
    const path = Reflect.getMetadata('path', target);
    if(!path) {
      console.log(target)
      throw new Error('@Crud must be used on a controller class with a path (you likely forgot to add @Controller before @Crud)');
    }

    
    Reflect.defineMetadata(CRUD_OPTIONS_METADATA, options, target);

    const queryUsesPagination = options.operations?.query !== false ? options.operations?.query?.pagination !== false : false;

    @ApiExtraModels(PaginationDto)
    @ApiExtraModels(options.createDto)
    @ApiExtraModels(options.updateDto)
    @ApiTags(options.tag ?? EntityNameUtil.classToName(options.entity))
    class CrudHost {

      @Post('import')
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiBody({ type: [options.createDto] })
      @ApiResponse({
        status: 201,
        description: 'The records where successfully created.',
        type: [options.entity],
      })
      async import(
        @Body([options.createDto]) body: C[],
        @Req() req: Request,
        @Param() params: any,
      ) {
        // Access 'this' which will be the UserController instance
        const self = this as unknown as ICrudController<T>;

        for (const item of body) {
          const persist = await options.persist?.(req, params) ?? {};
          const defaultValues = await options.defaultValues?.(req, params) ?? {};
          Object.assign(item as object, persist);
          Object.assign(item as object, defaultValues);
        }
        return await self.service.createMany(body as any[]); // Cast to any or RequiredEntityData
      }

      @Post()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 201,
        description: 'The record has been successfully created.',
        type: options.entity,
      })
      async create(
        @Body(options.createDto) body: C,
        @Req() req: Request,
        @Param() params: any,
      ) {
        // Access 'this' which will be the UserController instance
        const self = this as unknown as ICrudController<T>;

        const persist = await options.persist?.(req, params) ?? {};
        const defaultValues = await options.defaultValues?.(req, params) ?? {};
        Object.assign(body as object, persist);
        Object.assign(body as object, defaultValues);

        return await self.service.create(body as any);
      }

      @Get()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 200,
        schema: queryUsesPagination ? {
          allOf: [
            { $ref: getSchemaPath(PaginationDto) },
            {
              type: 'object',
              required: ['data',],
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: getSchemaPath(options.entity) },
                },
              },
            },
          ],
        } : {
          type: 'array',
          items: { $ref: getSchemaPath(options.entity) },
        }
      })
      @ApiQuery({ name: 'page', type: 'number', required: false, description: 'The page number, starting from 0' })
      @ApiQuery({ name: 'limit', type: 'number', required: false, description: 'The number of items per page' })
      async query(
        @Req() req: Request,
        @Param() params: any,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
      ) {
        const self = this as unknown as ICrudController<T>;
        const filter = await options?.filter?.(req, params);

        const queryOptions = options.operations?.query;
        const sort = typeof queryOptions === 'object' ? queryOptions?.sort : undefined;
        let orderBy: any = undefined;

        if (sort && Array.isArray(sort)) {
          orderBy = {};
          for (const s of sort) {
            orderBy[s.field] = s.order;
          }
        }

        if (queryUsesPagination) {
          if (!limit) limit = 100;
          if (!page) page = 0;

          const [data, total] = await self.service.query(filter ?? {}, {
            offset: page * limit,
            limit: limit,
            orderBy,
          });
          const pagination = new PaginationDto();
          Object.assign(pagination, {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          });
          return pagination;
        }

        return await self.service.findAll(filter ?? {}, { orderBy });
      }

      @Get("/export")
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiProduces('application/json', 'text/csv')
      @ApiResponse({
        status: 200,
        description: 'Export data',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: getSchemaPath(options.entity) }
            }
          },
          'text/csv': {
            schema: {
              type: 'string'
            }
          }
        }
      })
      async export(
        @Req() nestReq: Request,
        @Req() req: ExpressRequest,
        @Param() params: any,
        @Res({ passthrough: true }) res: ExpressResponse,
      ) {
        const self = this as unknown as ICrudController<T>;
        const filter = options?.filter?.(nestReq, params) ?? {};
        const isCsv = req.headers['accept'] === 'text/csv';

        const batchSize = 500;
        let page = 0;
        let aborted = false;

        req.on('close', () => {
          aborted = true;
        });

        async function* generateData() {
          while (!aborted) {
            const [items, _] = await self.service.query(filter, {
              offset: page * batchSize,
              limit: batchSize
            });

            if (items.length === 0) break;

            for (const item of items) {
              yield instanceToPlain(item);
            }

            if (items.length < batchSize) break;
            page++;
          }
        }

        if (isCsv) {
          res.header('Content-Type', 'text/csv');
          res.header('Content-Disposition', `attachment; filename=${options.tag ?? 'export'}.csv`);

          const transformOpts = { header: true };
          const json2csv = new CsvTransform(transformOpts);
          Readable.from(generateData()).pipe(json2csv).pipe(res);
        } else {
          res.header('Content-Type', 'application/json');

          async function* generateJson() {
            yield '[';
            let first = true;
            for await (const item of generateData()) {
              if (!first) yield ',';
              yield JSON.stringify(item);
              first = false;
            }
            yield ']';
          }

          Readable.from(generateJson()).pipe(res);
        }
      }

      @Get(':id')
      @ApiNotFoundResponse()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 200,
        type: options.entity,
      })
      async read(
        @Req() req: Request,
        @Param('id') id: string,
        @Param() params: any
      ) {
        const self = this as unknown as ICrudController<typeof options.entity['prototype']>;
        const filter = options?.filter?.(req, params);

        const result = await self.service.findOne({
          ...filter ?? {},
          [primaryKey]: parseId(id),
        } as FilterQuery<T>);

        if (!result) {
          throw new NotFoundException(`${EntityNameUtil.getName(options.entity.name)} not found`);
        }

        return result;
      }


      @Delete(':id')
      @ApiNotFoundResponse()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 204,
      })
      async delete(
        @Req() req: Request,
        @Param('id') id: string,
        @Param() params: any,
      ) {
        const self = this as unknown as ICrudController<typeof options.entity['prototype']>;
        const filter = options?.filter?.(req, params);

        const result = await self.service.findOne({
          ...filter ?? {},
          [primaryKey]: parseId(id),
        } as FilterQuery<T>);

        if (!result) {
          throw new NotFoundException(`${EntityNameUtil.getName(options.entity.name)} not found`);
        }
        await self.service.delete({ [primaryKey]: result[primaryKey] } as FilterQuery<T>);

        return;
      }
      @Patch(':id')
      @ApiNotFoundResponse()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 200,
        type: options.entity,
      })
      async replace(
        @Body(options.createDto) body: C,
        @Req() req: Request,
        @Param('id') id: string,
        @Param() params: any,
      ) {
        const self = this as unknown as ICrudController<typeof options.entity['prototype']>;
        const filter = options?.filter?.(req, params);

        const result = await self.service.findOne({
          ...filter ?? {},
          [primaryKey]: parseId(id),
        } as FilterQuery<T>);

        if (!result) {
          throw new NotFoundException(`${EntityNameUtil.getName(options.entity.name)} not found`);
        }

        return await self.service.update({ [primaryKey]: result[primaryKey] } as FilterQuery<T>, body as any);
      }

      @Put(':id')
      @ApiNotFoundResponse()
      @ApiBadRequestResponse()
      @ApiInternalServerErrorResponse()
      @ApiResponse({
        status: 200,
        type: options.entity,
      })
      async update(
        @Body(options.updateDto) body: U,
        @Req() req: Request,
        @Param('id') id: string,
        @Param() params: any,
      ) {
        const self = this as unknown as ICrudController<typeof options.entity['prototype']>;
        const filter = options?.filter?.(req, params);

        const result = await self.service.findOne({
          ...filter ?? {},
          [primaryKey]: parseId(id),
        } as FilterQuery<T>);

        if (!result) {
          throw new NotFoundException(`${EntityNameUtil.getName(options.entity.name)} not found`);
        }
        let toUpdateBody = {};
        Object.assign(toUpdateBody, body);
        for(const key in toUpdateBody) {
          if(toUpdateBody[key] === undefined) {
            delete toUpdateBody[key];
          }
        }

        return await self.service.update({ [primaryKey]: result[primaryKey] } as FilterQuery<T>, toUpdateBody as any);
      }
    }

    const methods = Object.getOwnPropertyNames(CrudHost.prototype).filter(method => method !== 'constructor');

    // -- API PARAM INJECTION --
    ApiPropertyUtil.processApiParams(target);


    // -- API PARAM INJECTION FOR CRUD HOST --
    const params: string[] = [];
    if (path) {
      const pathStr = Array.isArray(path) ? path[0] : path;
      if (typeof pathStr === 'string') {
        const regex = /:([^\/]+)/g;
        let match;
        while ((match = regex.exec(pathStr)) !== null) {
          params.push(match[1]);
        }
      }
    }

    for (const param of params) {
      const apiParamDecorator = ApiParam({ name: param, type: 'string' });
      for (const method of methods) {
        const descriptor = Object.getOwnPropertyDescriptor(CrudHost.prototype, method);
        if (descriptor) {
          apiParamDecorator(CrudHost.prototype, method, descriptor);
          Object.defineProperty(CrudHost.prototype, method, descriptor);
        }
      }
    }

    

    if (options.operations?.create === false) {
      delete (CrudHost.prototype as any).create;
    }
    if (options.operations?.update === false) {
      delete (CrudHost.prototype as any).update;
    }
    if (options.operations?.read === false) {
      delete (CrudHost.prototype as any).read;
    }
    if (options.operations?.query === false) {
      delete (CrudHost.prototype as any).query;
    }
    if (options.operations?.import !== true) {
      delete (CrudHost.prototype as any).import;
    }
    if (options.operations?.export !== true) {
      delete (CrudHost.prototype as any).export;
    }
    if (options.operations?.delete !== true) {
      delete (CrudHost.prototype as any).delete;
    }
    if (options.operations?.replace !== true) {
      delete (CrudHost.prototype as any).replace;
    }

    // -- METADATA INJECTION ---
    // Inject the metadata for the DTOs into the prototype
    for (const key of Object.getOwnPropertyNames(CrudHost.prototype)) {
      if (key === 'constructor') continue;
      const metadata = Reflect.getMetadata('design:paramtypes', CrudHost.prototype, key);
      Reflect.defineMetadata('design:paramtypes', [...metadata], CrudHost.prototype, key);
    }

    // --- PROTOTYPE INJECTION ---
    // Instead of forcing the user to extend a Mixin manually, we inject it into the prototype chain.

    // 1. Get the current parent of the target (e.g., Object)
    const originalParent = Object.getPrototypeOf(target.prototype);

    // 2. Make CrudHost inherit from that parent (preserving any existing inheritance)
    Object.setPrototypeOf(CrudHost.prototype, originalParent);

    // 3. Make target inherit from CrudHost
    // Target -> CrudHost -> OriginalParent
    Object.setPrototypeOf(target.prototype, CrudHost.prototype);
  };
}
