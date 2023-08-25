import { Component, OnInit, ViewChild } from '@angular/core';
import { MultiplayerService } from '../services/multiplayer.service';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
})
export class JoinGamePage implements OnInit {
  @ViewChild('streamContainer') videoContainer!: HTMLVideoElement
  roomId = ''
  roomConnected = false
  
  constructor(private multiplayerService: MultiplayerService) { }

  ngOnInit() {
  }

  get canJoin() {
    return this.roomId.length == 6
  }

  async joinGame() {
    await this.multiplayerService.joinRoom(this.roomId, this.videoContainer)
    this.roomConnected = true
  }

}
