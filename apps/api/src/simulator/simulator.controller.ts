import { simulatorCommandRequestSchema, type SimulatorCommandRequest } from '@hulajnogi/shared';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { SimulatorService } from './simulator.service.js';

/**
 * Ekran „Symulator floty” (ADR 0059, makieta `symulator`): tylko środowisko deweloperskie; przy wyłączonym
 * sterowaniu (`SIMULATOR_CONTROL_ENABLED=false`) oba punkty zwracają 404 i panel ukrywa pozycję.
 */
@ApiTags('panel: symulator')
@RequirePermission('simulator.manage')
@Controller('admin/simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Post('commands')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Polecenie scenariusza (rozłączenie, milczenie, rozładowanie, jazda do strefy albo punktu, strefa zakazu, przerwanie) na MQTT simulator/control z wpisem simulator.command w dzienniku audytu; wynik przychodzi zdarzeniem simulator.result',
  })
  command(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(new ZodPipe(simulatorCommandRequestSchema)) body: SimulatorCommandRequest,
  ) {
    return this.simulator.command(staff.staffId, body);
  }

  @Get('status')
  @ApiOkResponse({
    description: 'Ostatni stan z simulator/status (stale = brak stanu od 30 s) i ostatnie polecenia z wynikami',
  })
  status() {
    return this.simulator.overview();
  }
}
