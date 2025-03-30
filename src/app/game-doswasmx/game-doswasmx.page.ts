import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-game-doswasmx',
  templateUrl: './game-doswasmx.page.html',
  styleUrls: ['./game-doswasmx.page.scss'],
})
export class GameDoswasmxPage implements OnInit {
  
  constructor() { }

  ngOnInit() {

    let script = document.createElement('script');
    script.src = 'assets/doswasmx/romlist.js'
    document.getElementsByTagName('head')[0].appendChild(script);
    script.onload = () => {
      let script2 = document.createElement('script');
      script2.src = 'assets/doswasmx/settings.js'
      document.getElementsByTagName('head')[0].appendChild(script2);
    }
  }

  get data() {
    return myApp && myApp.rivetsData 
  }

  get myApp() {
    return myApp
  }

  dismissModal() {
  }
}
