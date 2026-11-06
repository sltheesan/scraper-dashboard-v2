import { IsEnum, IsString } from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @IsEnum(['ADMIN', 'OPERATOR', 'VIEWER'])
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
}
