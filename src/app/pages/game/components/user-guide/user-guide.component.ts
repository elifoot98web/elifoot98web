import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { GuideTab, HelpTopic, HelpTopicHelper } from 'src/app/core/helpers/help-topic.helper';
import { LayoutHelperService } from 'src/app/core/services/shared';

/**
 * The FAQ and the manual, in one window. A "?" in the menu, in a window or on a coach card opens it **at a topic** (HelpTopicHelper): the
 * tab that holds it is selected, the accordion is open, and the page is scrolled to it once the window has finished sliding in.
 *
 * "Once the window has finished sliding in" is the modal's `ionModalDidPresent`, not a delay. `ion-segment-view` pans to a tab by
 * `index * offsetWidth` and does so once, when it loads; Ionic only removes the modal's `display: none` after that, so on every open but
 * the first of a page load (the component is already registered, and loads while the modal is still hidden) the width it measured was 0
 * and the Manual button was lit over the FAQ's text. Asking the view again at the end of the slide measures a window that has a width.
 */
@Component({
  selector: 'app-user-guide',
  templateUrl: './user-guide.component.html',
  styleUrls: ['./user-guide.component.scss'],
  standalone: false
})
export class UserGuideComponent implements OnInit, AfterViewInit, OnDestroy {
  /** Where the "?" that opened the guide points. Absent for a plain "FAQ e manual": the FAQ, closed. */
  @Input() topic?: HelpTopic;

  tab: GuideTab = 'faq';
  faqOpen: string | null = null;
  manualOpen: string | null = null;
  manualSub: string | null = null;

  @ViewChild('segmentView', { read: ElementRef }) private segmentView?: ElementRef<HTMLElement & { setContent?: (id: string, smooth?: boolean) => Promise<void> }>;

  private modalEl: HTMLElement | null = null;
  private frame?: number;

  constructor(private modalController: ModalController, private layoutHelperService: LayoutHelperService, private host: ElementRef<HTMLElement>) { }

  ngOnInit(): void {
    if (!this.topic) return;
    this.tab = HelpTopicHelper.locate(this.topic).tab;
    this.faqOpen = HelpTopicHelper.sectionFor('faq', this.topic);
    this.manualOpen = HelpTopicHelper.sectionFor('manual', this.topic);
    this.manualSub = HelpTopicHelper.subFor('manual', this.topic);
  }

  ngAfterViewInit(): void {
    if (!this.topic) return;
    this.modalEl = this.host.nativeElement.closest('ion-modal');
    if (this.modalEl) this.modalEl.addEventListener('ionModalDidPresent', this.onPresented, { once: true });
    else this.onPresented();
  }

  ngOnDestroy(): void {
    this.modalEl?.removeEventListener('ionModalDidPresent', this.onPresented);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }

  private onPresented = (): void => {
    if (!this.topic) return;
    const anchor = HelpTopicHelper.anchorId(this.topic);
    // Instant: the person is not meant to watch the view cross the other tab on its way.
    const placed = this.tab === 'manual' ? this.segmentView?.nativeElement.setContent?.('manual-content', false) : undefined;
    void Promise.resolve(placed).then(() => {
      this.frame = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    });
  };

  get isMobile(): boolean {
    return this.layoutHelperService.isMobile
  }

  close() {
    this.modalController.dismiss();
  }
}
