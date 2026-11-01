import { FIELD_HINT } from '../models/constants';
import { FieldHintHelper } from './field-hint.helper';

describe('FieldHintHelper', () => {

  describe('combine', () => {

    it('says field while a caret blinks, however old the last tap is', () => {
      expect(FieldHintHelper.combine({ caret: true, ibeam: null }, 1000)).toBe('field');
      expect(FieldHintHelper.combine({ caret: true, ibeam: { at: 0, seen: false } }, 60_000)).toBe('field');
    });

    it('says field for a while after a tap that landed on an I-beam, and then stops', () => {
      const ibeam = { at: 1000, seen: true };
      expect(FieldHintHelper.combine({ caret: false, ibeam }, 1000)).toBe('field');
      expect(FieldHintHelper.combine({ caret: false, ibeam }, 1000 + FIELD_HINT.IBEAM_TTL_MS)).toBe('field');
      expect(FieldHintHelper.combine({ caret: false, ibeam }, 1000 + FIELD_HINT.IBEAM_TTL_MS + 1)).toBe('none');
    });

    it('says none after a tap that landed on an arrow, and with no signal at all', () => {
      expect(FieldHintHelper.combine({ caret: false, ibeam: { at: 1000, seen: false } }, 1001)).toBe('none');
      expect(FieldHintHelper.combine({ caret: false, ibeam: null }, 1001)).toBe('none');
    });

    it('lets a caret that went out fall back to what the last tap said', () => {
      const ibeam = { at: 5000, seen: true };
      expect(FieldHintHelper.combine({ caret: true, ibeam }, 6000)).toBe('field');
      expect(FieldHintHelper.combine({ caret: false, ibeam }, 6000)).toBe('field');
      expect(FieldHintHelper.combine({ caret: false, ibeam }, 20_000)).toBe('none');
    });
  });

  describe('staleIn', () => {

    it('is how long a lone I-beam signal has left, and null when nothing will change by itself', () => {
      expect(FieldHintHelper.staleIn({ caret: false, ibeam: { at: 1000, seen: true } }, 2000)).toBe(FIELD_HINT.IBEAM_TTL_MS - 1000);
      expect(FieldHintHelper.staleIn({ caret: false, ibeam: { at: 1000, seen: true } }, 1000 + FIELD_HINT.IBEAM_TTL_MS)).toBeNull();
      expect(FieldHintHelper.staleIn({ caret: true, ibeam: { at: 1000, seen: true } }, 2000)).toBeNull();
      expect(FieldHintHelper.staleIn({ caret: false, ibeam: { at: 1000, seen: false } }, 2000)).toBeNull();
      expect(FieldHintHelper.staleIn({ caret: false, ibeam: null }, 2000)).toBeNull();
    });
  });

  describe('label', () => {
    it('words the badge', () => {
      expect(FieldHintHelper.label('field')).toBe('campo detectado');
      expect(FieldHintHelper.label('none')).toBe('nenhum campo detectado');
    });
  });
});
