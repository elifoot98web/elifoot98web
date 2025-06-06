import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LayoutHelperService {
  constructor() {}

  get isLandscape(): boolean {
    return window.innerWidth > window.innerHeight
  }

  get isPortrait(): boolean {
    return !this.isLandscape
  }

  get isMobile(): boolean {
    return (this.isLandscape && window.innerHeight < 768) || window.innerWidth < 768
  }

  get isDesktop(): boolean {
    return !this.isMobile
  }
}
