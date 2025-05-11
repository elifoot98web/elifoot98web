import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LayoutHelperService {
  private isLandscape: boolean = false
  private isMobile: boolean = false

  onWindowResize() {
    this.isLandscape = window.innerWidth > window.innerHeight
    this.isMobile = this.isLandscape && window.innerHeight < 768 || window.innerWidth < 768
  }

  constructor() { }

  get isLandscapeMode(): boolean {
    return this.isLandscape
  }

  get isPortraitMode(): boolean {
    return !this.isLandscape
  }

  get isMobileMode(): boolean {
    return this.isMobile
  }

  get isDesktopMode(): boolean {
    return !this.isMobile
  }
}
