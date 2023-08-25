import { Component, OnInit, ViewChild } from '@angular/core';
import { MultiplayerService } from '../services/multiplayer.service';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
})
export class JoinGamePage implements OnInit {
  roomId = ''
  roomConnected = false
  
  constructor(private multiplayerService: MultiplayerService) { }

  ngOnInit() {
  }

  get canJoin() {
    return this.roomId.length >= 6
  }

  async joinGame() {
    const video = document.querySelector('#stream-container') as HTMLVideoElement
    if(!video) throw new Error('Video element not found')
    
    const stream = await this.multiplayerService.joinRoom(this.roomId)
    console.log('Remote Stream:', { stream })
    video.srcObject = stream
    this.roomConnected = true
  }

}
