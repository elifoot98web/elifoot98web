import { Component, Input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * The 'O Matic walkthrough, on YouTube's privacy-enhanced host: by YouTube's own description it
 * stores nothing about a visitor until the video is played. Not verified here, which is one more
 * reason the iframe only exists after a tap.
 */
const OMATIC_VIDEO_URL = 'https://www.youtube-nocookie.com/embed/m5QaqyveP6U?autoplay=1';

@Component({
  selector: 'app-manual',
  templateUrl: './manual.component.html',
  styleUrls: ['./manual.component.scss'],
  standalone: false
})
export class ManualComponent {
  /**
   * The chapter to open, when a "?" sent the player here (HelpTopicHelper): an accordion `value` of the outer group, and `sub` the one
   * inside it, for the chapters that have a group of their own (the menu's). Without one the first chapter is open.
   */
  @Input() open: string | null | undefined = null;
  @Input() sub: string | null | undefined = null;

  /** False until the tap: nothing from YouTube is requested before that. */
  videoRequested = false;

  /**
   * Angular refuses an unmarked URL as an iframe `src`. The address is a constant of this file,
   * so trusting it is not trusting anything a user or a peer can influence.
   */
  readonly omaticVideoUrl: SafeResourceUrl;

  constructor(sanitizer: DomSanitizer) {
    this.omaticVideoUrl = sanitizer.bypassSecurityTrustResourceUrl(OMATIC_VIDEO_URL);
  }

  /** `autoplay=1` is in the URL because the tap that gets here is the user's request to play. */
  loadVideo() {
    this.videoRequested = true;
  }
}
