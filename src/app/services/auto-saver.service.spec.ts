import { TestBed } from '@angular/core/testing';

import { AutoSaverService } from './auto-saver.service';

describe('AutoSaverService', () => {
  let service: AutoSaverService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AutoSaverService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
