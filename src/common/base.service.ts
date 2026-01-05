import { EntityRepository, FilterQuery, FindOptions, RequiredEntityData, EntityData, AnyEntity } from '@mikro-orm/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityNameUtil } from './utils/entity-name.util';
import { CRUDEventCreate, CRUDEventDelete, CRUDEventUpdate } from './base.event';

export abstract class BaseService<T extends AnyEntity> {

  slug: string;

  protected constructor(
    protected readonly repository: EntityRepository<T>,
    protected readonly eventEmitter?: EventEmitter2,
  ) {
    this.slug = EntityNameUtil.classToSlug(this.repository.getEntityName());
  }

  async findAll(where: FilterQuery<T>, options?: FindOptions<T>) {
    return this.repository.find(where, options);
  }

  async query(where: FilterQuery<T>, options: FindOptions<T>) {
    return this.repository.findAndCount(where, options);
  }

  async count(where: FilterQuery<T>, options?: FindOptions<T>) {
    return this.repository.count(where, options);
  }

  async findOne(where: FilterQuery<T>) {
    return this.repository.findOne(where);
  }

  async delete(where: FilterQuery<T>) {
    const read = await this.findOne(where)!;
    this.eventEmitter?.emit(`${this.slug}.deleted`, new CRUDEventDelete(read));
    return this.repository.nativeDelete(where);
  }

  async create(data: RequiredEntityData<T>) {
    const entity = this.repository.create(data);
    await this.repository.getEntityManager().persist(entity).flush();
    this.eventEmitter?.emit(`${this.slug}.created`, new CRUDEventCreate(entity));
    return entity;
  }

  async createMany(data: RequiredEntityData<T>[]) {
    const entities = data.map(d => this.repository.create(d));
    await this.repository.getEntityManager().persist(entities).flush();
    for (const entity of entities) {
      this.eventEmitter?.emit(`${this.slug}.created`, new CRUDEventCreate(entity));
    }
    return entities;
  }

  async update(where: FilterQuery<T>, data: EntityData<T>) {
    const result = await this.findOne(where)!;
    Object.assign(result, data);
    await this.repository.getEntityManager().flush();
    this.eventEmitter?.emit(`${this.slug}.updated`, new CRUDEventUpdate(result));
    return result;
  }

}
