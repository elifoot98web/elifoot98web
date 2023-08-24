import { Injectable } from '@angular/core';
import { HostInfo } from '../models/hostInfo';
import { AngularFirestore, AngularFirestoreDocument } from '@angular/fire/compat/firestore';
import { environment } from 'src/environments/environment';
import { GameRoom } from '../models/gameRoom';
import ShortUniqueId from 'short-unique-id';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerService {
  private peerConnection!: RTCPeerConnection
  private roomRef!: AngularFirestoreDocument<GameRoom>
  private uidGenerator = new ShortUniqueId({ dictionary: 'alphanum_lower' });
  private remoteStream = new MediaStream()
  constructor(private afStore: AngularFirestore) {}

  async createRoom(hostInfo: HostInfo, canvas: HTMLCanvasElement) {
    const roomId: string = this.uidGenerator()
    this.roomRef = await this.afStore.collection('rooms').doc<GameRoom>(roomId)
    
    // Setup peer connection
    this.setupConnection()
    
    const stream = canvas.captureStream()
    stream.getTracks().forEach((track, i) => {
      console.log('Adding Track: #'+i, {track})
      this.peerConnection.addTrack(track, stream)
    })


    // Collecting ICE candidates
    const callerCandidatesCollection = this.roomRef.collection('callerCandidates')
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!')
        return
      }
      console.log('Got candidate: ', event.candidate)
      callerCandidatesCollection.add(event.candidate.toJSON())
    })

    // Finally creating a room
    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)
    console.log('Created offer:', offer)

    const roomWithOffer: GameRoom = {
      id: roomId,
      hostPlayerName: hostInfo.playerName,
      hostPlayerId: hostInfo.playerId,
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      }
    }

    await this.roomRef.set(roomWithOffer)
    console.log(`New room created with SDP offer. Room ID: ${roomId}`)
    console.log({roomWithOffer})

    // Listening for remote session description
    this.roomRef.ref.onSnapshot(async snapshot => {
      const data = snapshot.data() as any;
      if (!this.peerConnection.currentRemoteDescription && data && data.answer) {
        console.log('Got remote description: ', data.answer);
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        await this.peerConnection.setRemoteDescription(rtcSessionDescription);
      }
    });

    // Listen for remote ICE candidates below
    this.roomRef.collection('calleeCandidates').ref.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  }

  async joinRoom(roomId: string, videoElement: HTMLVideoElement) {
    this.roomRef = await this.afStore.collection('rooms').doc<GameRoom>(roomId)
    const roomSnapshot = await this.roomRef.ref.get()

    if (!roomSnapshot.exists) {
      throw new Error(`Jogo com ID: ${roomId} não existe`)
    }

    this.setupConnection()

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = this.roomRef.collection('calleeCandidates');
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });

    // Setup media source
    this.remoteStream = new MediaStream()
    videoElement.srcObject = this.remoteStream
   
    // Capture incoming stream
    this.peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        this.remoteStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    const offer: any = roomSnapshot.data()?.offer
    if(!offer) {
      throw new Error('Erro conectando ao jogo remoto')
    }

    console.log('Got offer:', offer);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await this.peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await this.roomRef.update(roomWithAnswer);
  }

  private setupConnection() {
    const config = {
      iceServers: [
        {
          urls: environment.multiplayer.iceServers,
        },
      ],
      iceCandidatePoolSize: environment.multiplayer.iceCandidatePoolSize,
    }
    this.peerConnection = new RTCPeerConnection(config)
    this.registerPeerConnectionListeners()
  }

  private registerPeerConnectionListeners() {
    this.peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log(
          `ICE gathering state changed: ${this.peerConnection.iceGatheringState}`);
    });
  
    this.peerConnection.addEventListener('connectionstatechange', () => {
      console.log(`Connection state change: ${this.peerConnection.connectionState}`);
    });
  
    this.peerConnection.addEventListener('signalingstatechange', () => {
      console.log(`Signaling state change: ${this.peerConnection.signalingState}`);
    });
  
    this.peerConnection.addEventListener('iceconnectionstatechange ', () => {
      console.log(
          `ICE connection state change: ${this.peerConnection.iceConnectionState}`);
    });
  }

}


