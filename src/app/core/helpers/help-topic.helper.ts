/**
 * Where in the guide a "?" lands. The guide (UserGuideComponent) is two tabs of accordions, and an accordion opens when its `value`
 * is the group's; so a "?" in the menu, in a window or on a coach card is a name, and this is the table from the name to the
 * accordion it opens. Kept free of Angular so the table can be tested on plain strings.
 *
 * **The values here are the guide's.** `section` is an accordion `value` in the tab, and `sub` one inside it (the manual's
 * "Menu de opções" holds a group of its own). A rename in faq.component.html or manual.component.html that is not made here
 * leaves a "?" that opens the guide and nothing in it, silently; help-topic.helper.spec.ts renders both components and fails when
 * a topic points at an accordion that does not exist.
 */
export type HelpTopic =
  | 'first-steps'
  | 'touch' | 'typing' | 'save' | 'keys'
  | 'menu-game' | 'menu-input' | 'menu-display'
  | 'menu-backup' | 'menu-autosave' | 'menu-patch' | 'menu-tools' | 'menu-experimental' | 'menu-danger'
  | 'multiplayer' | 'zoom' | 'sound';

export type GuideTab = 'faq' | 'manual';

export interface HelpLocation {
  tab: GuideTab;
  /** The accordion of the tab's outer group. */
  section: string;
  /** The accordion inside it, when the section has a group of its own. */
  sub?: string;
}

const LOCATIONS: Readonly<Record<HelpTopic, HelpLocation>> = {
  // The coach's three cards, and the manual's chapter that says the same at more length.
  'first-steps': { tab: 'manual', section: 'first-steps' },
  'touch': { tab: 'faq', section: 'mouse-info' },
  'typing': { tab: 'faq', section: 'keyboard-info' },
  'save': { tab: 'faq', section: 'save-info' },
  'keys': { tab: 'manual', section: 'aux-controls' },
  // One topic per section of the options sheet, and one per group of "Dados e avançado".
  'menu-game': { tab: 'manual', section: 'options-menu', sub: 'menu-game' },
  'menu-input': { tab: 'manual', section: 'options-menu', sub: 'menu-input' },
  'menu-display': { tab: 'manual', section: 'options-menu', sub: 'menu-display' },
  'menu-backup': { tab: 'manual', section: 'options-menu', sub: 'menu-backup' },
  'menu-autosave': { tab: 'manual', section: 'options-menu', sub: 'menu-autosave' },
  'menu-patch': { tab: 'manual', section: 'options-menu', sub: 'menu-patch' },
  'menu-tools': { tab: 'manual', section: 'options-menu', sub: 'menu-tools' },
  'menu-experimental': { tab: 'manual', section: 'options-menu', sub: 'menu-experimental' },
  'menu-danger': { tab: 'manual', section: 'options-menu', sub: 'menu-danger' },
  'multiplayer': { tab: 'manual', section: 'multiplayer' },
  'zoom': { tab: 'faq', section: 'zoom-info' },
  'sound': { tab: 'faq', section: 'sound-info' },
};

export class HelpTopicHelper {

  static locate(topic: HelpTopic): HelpLocation {
    return LOCATIONS[topic];
  }

  /** Every topic, for the spec that checks them against the guide. */
  static topics(): HelpTopic[] {
    return Object.keys(LOCATIONS) as HelpTopic[];
  }

  /**
   * The accordion `value` an outer group should be given to open a topic, or null for the other tab's: a tab only
   * opens what is in it, and the one that is not shown must not open something else by accident.
   */
  static sectionFor(tab: GuideTab, topic: HelpTopic | null | undefined): string | null {
    const at = topic ? LOCATIONS[topic] : null;
    return at && at.tab === tab ? at.section : null;
  }

  /** The accordion inside the section to open, when the topic is in the manual's menu group. */
  static subFor(tab: GuideTab, topic: HelpTopic | null | undefined): string | null {
    const at = topic ? LOCATIONS[topic] : null;
    return at && at.tab === tab ? at.sub ?? null : null;
  }

  /** The DOM id the guide gives the accordion that holds the topic, to scroll it into view once it opens. */
  static anchorId(topic: HelpTopic): string {
    const at = LOCATIONS[topic];
    return `guide-${at.tab}-${at.sub ?? at.section}`;
  }
}
