import { ApiProperty } from "@nestjs/swagger";
import { Expose } from "class-transformer";

export class PaginationDto<T> {
    @Expose()
    @ApiProperty({ description: 'Page number', example: 1 })
    page: number;

    @Expose()
    @ApiProperty({ description: 'Limit number', example: 50 })
    limit: number;
    
    @Expose()
    @ApiProperty({ description: 'Total pages', example: 10 })
    totalPages: number;

    @Expose()
    @ApiProperty({ description: 'Total count', example: 100 })
    total: number;

    @Expose()
    data: T[];
}