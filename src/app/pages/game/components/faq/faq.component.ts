import { Component } from '@angular/core';
import { CAMERA, EMULATOR_POWER } from '../../../../core/models/constants';

@Component({
  selector: 'app-faq',
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss'],
  standalone: false
})
export class FaqComponent {
  /** The battery saver entry quotes these, so a change of the constants reaches the answer (see EMULATOR_POWER). */
  readonly idleSeconds = Math.round(EMULATOR_POWER.IDLE_MS / 1000);
  readonly savingByDefault = EMULATOR_POWER.DEFAULT_ENABLED;
  /** The zoom entry says whether the camera is on by default; the constant is the one place that changes (see CAMERA). */
  readonly zoomByDefault = CAMERA.DEFAULT_ENABLED;

  constructor() { }

}
