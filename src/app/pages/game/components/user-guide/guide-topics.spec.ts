import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HelpTopicHelper } from 'src/app/core/helpers/help-topic.helper';
import { FaqComponent } from '../faq/faq.component';
import { ManualComponent } from '../manual/manual.component';

/**
 * A "?" is only worth anything if the accordion it names is in the guide. The topics are names (HelpTopicHelper) and the accordions are
 * markup in two templates, so a rename in either leaves a "?" that opens the guide and nothing in it. This renders both templates, with
 * Ionic's elements as plain unknown elements, and reads their static `value` and `id` attributes: no behaviour, only that the places exist.
 */
describe('the guide answers every help topic', () => {
  let faq: HTMLElement;
  let manual: HTMLElement;
  let fixtures: ComponentFixture<unknown>[];

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [FaqComponent, ManualComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] });
    const faqFixture = TestBed.createComponent(FaqComponent);
    const manualFixture = TestBed.createComponent(ManualComponent);
    faqFixture.detectChanges();
    manualFixture.detectChanges();
    fixtures = [faqFixture, manualFixture];
    faq = faqFixture.nativeElement;
    manual = manualFixture.nativeElement;
  });

  afterEach(() => fixtures.forEach(fixture => fixture.destroy()));

  const accordion = (root: HTMLElement, id: string) => root.querySelector(`ion-accordion[id="${id}"]`);

  it('has, for every topic, an accordion with the id the guide scrolls to and the value the group opens', () => {
    for (const topic of HelpTopicHelper.topics()) {
      const at = HelpTopicHelper.locate(topic);
      const root = at.tab === 'faq' ? faq : manual;
      const element = accordion(root, HelpTopicHelper.anchorId(topic));
      expect(element).withContext(`${topic} -> ${HelpTopicHelper.anchorId(topic)}`).not.toBeNull();
      expect(element?.getAttribute('value')).withContext(topic).toBe(at.sub ?? at.section);
    }
  });

  it('keeps a topic with a sub-accordion inside its chapter', () => {
    for (const topic of HelpTopicHelper.topics()) {
      const at = HelpTopicHelper.locate(topic);
      if (!at.sub) continue;
      const chapter = accordion(manual, `guide-manual-${at.section}`);
      expect(chapter?.querySelector(`ion-accordion[id="guide-manual-${at.sub}"]`)).withContext(topic).not.toBeNull();
    }
  });

  it('gives every accordion of both tabs a value and an id of the form guide-<tab>-<value>, each of them once', () => {
    for (const [tab, root] of [['faq', faq], ['manual', manual]] as const) {
      const ids = Array.from(root.querySelectorAll('ion-accordion')).map(element => {
        const value = element.getAttribute('value');
        expect(value).withContext(`an accordion of the ${tab} has no value`).toBeTruthy();
        expect(element.getAttribute('id')).withContext(`${tab}: ${value}`).toBe(`guide-${tab}-${value}`);
        return element.getAttribute('id');
      });
      expect(new Set(ids).size).withContext(tab).toBe(ids.length);
    }
  });

  it('does not quote the menu\'s old words: the double negatives, the jargon, the removed submenus', () => {
    const text = (faq.textContent ?? '') + (manual.textContent ?? '');
    for (const old of ['Desativar Suavização', 'Desativar Sync Save', 'Save Periódico', 'Dados e Backups', 'Opções de Patch', 'Input de Texto', 'Hospedar Jogo Multiplayer']) {
      expect(text).withContext(old).not.toContain(old);
    }
  });
});
