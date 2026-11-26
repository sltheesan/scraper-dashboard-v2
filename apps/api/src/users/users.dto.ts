import { IsString, IsOptional } from 'class-validator';

export class UpdateGroupDto {
  @IsString()
  @IsOptional()
  groupId: string | null;
}
