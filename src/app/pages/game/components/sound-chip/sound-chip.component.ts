import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { distinctUntilChanged, map, Observable } from 'rxjs';
import { AudioHealthHelper } from 'src/app/core/helpers/audio-health.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';
import { AudioHealthService } from 'src/app/core/services/game';

/**
 * "Ativar som": there only while the game's sound is blocked (AudioHealthService: the audio context
 * is asleep on a visible page and the page could not wake it), and gone the moment it runs. A tap
 * resumes the context, inside the tap, which is the one thing WebKit counts.
 *
 * Shell chrome, so flat and not Win9x (`.sound-chip` in global.scss shares the save chip's look and
 * its hit area). It sits in the toolbar's end slot, and in the gutter beside the picture where a
 * landscape phone has no toolbar (`variant="gutter"`). Under 600 px it is the speaker alone: the
 * words are its accessible name, and the toolbar's title slot has the room code to protect.
 *
 * It takes no focus from the game: the tap hands the focus back to the emulator's root, because a
 * physical keyboard on a tablet would otherwise stop reaching the game until the next click on it.
 */
@Component({
  selector: 'app-sound-chip',
  templateUrl: './sound-chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class SoundChipComponent {
  /** `toolbar` (the default) or `gutter`, the round button beside the picture on a landscape phone. */
  @Input() variant: 'toolbar' | 'gutter' = 'toolbar';
  /** A host's silence is also the room's: the accessible name says so. */
  @Input() hosting = false;

  readonly blocked$: Observable<boolean>;

  constructor(private audio: AudioHealthService) {
    this.blocked$ = this.audio.status$.pipe(map(status => status.blocked), distinctUntilChanged());
  }

  get label(): string {
    return AudioHealthHelper.chipLabel(this.hosting);
  }

  onTap(): void {
    this.audio.activate();
    ChatPanelHelper.focusEmulator();
  }
}
