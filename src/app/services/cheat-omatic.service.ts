import { Injectable } from '@angular/core';
import { DosCI } from '../models/jsdos';

@Injectable({
  providedIn: 'root'
})
export class CheatOmaticService {
  dosCI?: DosCI
  constructor() { }
}
