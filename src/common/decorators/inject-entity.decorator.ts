import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UseInterceptors,
  createParamDecorator,
  NotFoundException,
  applyDecorators,
  BadRequestException,
  SerializeOptions
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CRUD_OPTIONS_METADATA, FETCHED_ENTITY_KEY } from '../constants';
import { CrudOptions } from '../interfaces/crud-options.interface';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import { ObjectId as MongoObjectId } from 'mongodb';
import { ObjectId } from '@mikro-orm/mongodb';
import { EntityNameUtil } from '../utils/entity-name.util';

@Injectable()
export class CrudEntityInterceptor implements NestInterceptor {
  constructor(private readonly em: EntityManager) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const target = context.getClass();
    const options: CrudOptions<any> = Reflect.getMetadata(CRUD_OPTIONS_METADATA, target);

    if (!options || !options.entity) {
      return next.handle();
    }

    const params = req.params;

    // Discover Primary Key
    const metadata = this.em.getMetadata().get(options.entity.name);
    const primaryKey = metadata?.primaryKeys[0] || 'id';

    // Check if ID is in params
    const idValue = params[primaryKey];

    if (!idValue) {
      // No ID found in params, skip fetching
      return next.handle();
    }

    // Parse ID
    let parsedId: any = idValue;
    // We can check metadata property type
    const prop = metadata?.properties[primaryKey];

    if (prop) {
      if (prop.type === 'ObjectId' || (prop.type as any) === ObjectId || (prop.type as any) === MongoObjectId) {
        try {
          parsedId = new MongoObjectId(idValue);
        } catch (e) {
          throw new BadRequestException('Invalid ObjectId');
        }
      } else if (prop.type === 'number' || (prop.type as any) === Number) {
        parsedId = Number(idValue);
        if (isNaN(parsedId)) {
          throw new BadRequestException('Invalid ID');
        }
      }
    } else {
      // Fallback to design:type
      const primaryKeyType = Reflect.getMetadata('design:type', options.entity.prototype, primaryKey);
      if (primaryKeyType === ObjectId || primaryKeyType === MongoObjectId) {
        try {
          parsedId = new MongoObjectId(idValue);
        } catch (e) {
          throw new BadRequestException('Invalid ObjectId');
        }
      } else if (primaryKeyType === Number) {
        parsedId = Number(idValue);
        if (isNaN(parsedId)) {
          throw new BadRequestException('Invalid ID');
        }
      }
    }

    // Apply Filter
    let filter: FilterQuery<any> = {};
    if (options.filter) {
      filter = await options.filter(req, params) || {};
    }

    // Fetch Entity
    const repo = this.em.getRepository(options.entity);
    const entity = await repo.findOne({
      ...filter,
      [primaryKey]: parsedId
    } as FilterQuery<any>);

    if (!entity) {
      throw new NotFoundException(`${EntityNameUtil.getName(options.entity.name)} not found`);
    }

    // Attach to request
    req[FETCHED_ENTITY_KEY] = entity;

    return next.handle();
  }
}

/**
 * Class Decorator to enable auto-fetching of entity based on Crud options and route params.
 * 
 * Note that you should also disable serialization if you need to return anything else in the reponse.
 * @SerializeOptions({ strategy: 'exposeAll' });
 * 
 */
export function InjectCrudEntity() {
  return (target: Function) => {
    const decorators: (ClassDecorator | MethodDecorator | PropertyDecorator)[] = [
      UseInterceptors(CrudEntityInterceptor),
    ];

    applyDecorators(...decorators)(target);
  };
}

/**
 * Parameter Decorator to retrieve the fetched entity.
 */
export const FetchedEntity = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request[FETCHED_ENTITY_KEY];
  },
);
