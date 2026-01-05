import { EntityRepository, FilterQuery, FindOptions, RequiredEntityData, AnyEntity, ReferenceKind } from '@mikro-orm/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { EntityNameUtil } from './utils/entity-name.util';
import { BaseService } from './base.service';

export abstract class BaseRelatedService<T extends AnyEntity, R extends AnyEntity> extends BaseService<T> {

  slug: string;

  protected constructor(
    protected readonly repository: EntityRepository<T>,
    protected readonly relatedRepository: EntityRepository<R>,
    protected readonly eventEmitter?: EventEmitter2,
  ) {
    super(repository, eventEmitter);
  }

  async findAll(where: FilterQuery<T>, options?: FindOptions<T>) {
    return this.repository.find(where, options);
  }

  async query(where: FilterQuery<T>, options: FindOptions<T>) {
    return this.repository.findAndCount(where, options);
  }

  async findOne(where: FilterQuery<T>) {
    return this.repository.findOne(where);
  }

  async create(data: RequiredEntityData<T>) {
    await this.validateRelatedEntity(data);
    return super.create(data);
  }

  async createMany(data: RequiredEntityData<T>[]) {
    for (const item of data) {
      await this.validateRelatedEntity(item);
    }
    return super.createMany(data);
  }

  private async validateRelatedEntity(data: RequiredEntityData<T>) {
    const em = this.repository.getEntityManager();
    const meta = em.getMetadata().get(this.repository.getEntityName());
    const relatedName = this.relatedRepository.getEntityName();

    for (const prop of meta.relations) {
      if (prop.type !== relatedName) continue;
      if (prop.kind !== ReferenceKind.MANY_TO_ONE && prop.kind !== ReferenceKind.ONE_TO_ONE) continue;

      const val = data[prop.name];
      if (!val) continue;
      
      const related = await this.relatedRepository.findOne(val);
      if (!related) {
        throw new NotFoundException(`${EntityNameUtil.classToName({ name: relatedName })} not found`);
      }
      data[prop.name] = related;
    }
  }

}
