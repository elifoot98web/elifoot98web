import { HelpTopicHelper } from './help-topic.helper';

describe('HelpTopicHelper', () => {

  it('knows where every topic opens, in a tab the guide has', () => {
    for (const topic of HelpTopicHelper.topics()) {
      const at = HelpTopicHelper.locate(topic);
      expect(['faq', 'manual']).toContain(at.tab);
      expect(at.section.length).toBeGreaterThan(0);
    }
  });

  it('only gives a sub-accordion to the manual\'s menu chapter, the one with a group of its own', () => {
    for (const topic of HelpTopicHelper.topics()) {
      const at = HelpTopicHelper.locate(topic);
      if (at.sub) {
        expect(at.tab).toBe('manual');
        expect(at.section).toBe('options-menu');
      }
    }
  });

  it('has a topic for every section of the options sheet, every group of "Dados e avançado" and each card of the coach', () => {
    const topics = HelpTopicHelper.topics();
    for (const needed of ['menu-game', 'menu-input', 'menu-display', 'multiplayer',
      'menu-backup', 'menu-autosave', 'menu-patch', 'menu-tools', 'menu-experimental', 'menu-danger', 'touch', 'typing', 'save']) {
      expect(topics).toContain(needed as never);
    }
  });

  it('opens a tab only on what is in it: the other tab\'s topics leave it alone', () => {
    expect(HelpTopicHelper.sectionFor('faq', 'save')).toBe('save-info');
    expect(HelpTopicHelper.sectionFor('manual', 'save')).toBeNull();
    expect(HelpTopicHelper.sectionFor('manual', 'menu-backup')).toBe('options-menu');
    expect(HelpTopicHelper.subFor('manual', 'menu-backup')).toBe('menu-backup');
    expect(HelpTopicHelper.sectionFor('faq', 'menu-backup')).toBeNull();
    expect(HelpTopicHelper.subFor('faq', 'menu-backup')).toBeNull();
  });

  it('opens nothing for no topic', () => {
    expect(HelpTopicHelper.sectionFor('faq', undefined)).toBeNull();
    expect(HelpTopicHelper.sectionFor('manual', null)).toBeNull();
    expect(HelpTopicHelper.subFor('manual', undefined)).toBeNull();
  });

  it('names the element to scroll to after the accordion\'s own id: a chapter\'s, or the one inside it', () => {
    expect(HelpTopicHelper.anchorId('save')).toBe('guide-faq-save-info');
    expect(HelpTopicHelper.anchorId('multiplayer')).toBe('guide-manual-multiplayer');
    expect(HelpTopicHelper.anchorId('menu-danger')).toBe('guide-manual-menu-danger');
  });
});
