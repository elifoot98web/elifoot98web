import { NgZone } from '@angular/core';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { EmulatorPowerService } from './emulator-power.service';

/**
 * Stand-ins for specs. Nothing here is imported by the app, so none of it reaches the bundle.
 *
 * A power service that was never `start()`ed does nothing: `wake()` and `hold()` return at once. That
 * is what every spec of a service that merely calls it wants, and what the real one is in a page
 * whose switch is off.
 */
export function silentPower(): EmulatorPowerService {
  return new EmulatorPowerService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics());
}
