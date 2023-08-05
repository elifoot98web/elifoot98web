import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AtivadorPage } from './ativador.page';

describe('AtivadorPage', () => {
  let component: AtivadorPage;
  let fixture: ComponentFixture<AtivadorPage>;

  beforeEach(async(() => {
    fixture = TestBed.createComponent(AtivadorPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
