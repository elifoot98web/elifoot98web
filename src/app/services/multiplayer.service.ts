import { Injectable, OnDestroy } from '@angular/core';
import { HostInfo } from '../models/hostInfo';
import { AngularFirestore, AngularFirestoreDocument } from '@angular/fire/compat/firestore';
import { environment } from 'src/environments/environment';
import { GameRoom } from '../models/gameRoom';
import ShortUniqueId from 'short-unique-id';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerService implements OnDestroy {
  private peerConnection!: RTCPeerConnection
  private roomRef!: AngularFirestoreDocument<GameRoom>
  private uidGenerator = new ShortUniqueId({ dictionary: 'alphanum_lower' });
  
  constructor(private afStore: AngularFirestore) {}

  ngOnDestroy() {
    console.log("###### SERVICE DESTROYED")
  }

  async createRoom(hostInfo: HostInfo, canvasStream: MediaStream) {
    const roomId: string = this.uidGenerator()
    
    this.roomRef = await this.afStore.collection('rooms').doc<GameRoom>(roomId)
    
    // Setup peer connection
    this.setupConnection()
    
    // Add local stream tracks to peer connection
    const stream = canvasStream // 24 fps
    stream.getTracks().forEach((track, i) => {
      console.log(`Adding Track: #${i} to stream`, {stream, track})
      this.peerConnection.addTrack(track, stream)
    })


    // Collecting ICE candidates
    this.collectCallerIceCandidates()

    // Creating room offer
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

    console.log(`Criando sala com ID: ${roomId}`)
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
    this.setupCalleeIceCandidatesListening()

    return roomId
  }

  async joinRoom(roomId: string): Promise<MediaStream> {
    console.log(`Entrando na sala com ID: ${roomId}`)
    this.roomRef = await this.afStore.collection('rooms').doc<GameRoom>(roomId)
    const roomSnapshot = await this.roomRef.ref.get()

    if (!roomSnapshot.exists) {
      throw new Error(`Jogo com ID: ${roomId} não existe`)
    }

    this.setupConnection()
    


    // Code for collecting callee ICE candidates below
    this.collectCalleeIceCandidates()

    // Setup media source
    const remoteStream = new MediaStream()
    console.log('Created remote stream:', {remoteStream})
    // Capture incoming stream
    this.peerConnection.addEventListener('track', event => {
      // const video = document.querySelector('#stream-container') as HTMLVideoElement
      // if(!video) throw new Error('Video element not found')
      // video.srcObject = event.streams[0]
      console.log('###### Got remote track:', { event });
      event.streams.forEach(stream => {
        stream.getTracks().forEach(track => {
          console.log('Add a track to the remoteStream:', {remoteStream, track});
          remoteStream.addTrack(track);
        })  
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

    return remoteStream
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
    console.log("Peer Connection Created with config:", {peerConnection: this.peerConnection, config})
    this.registerPeerConnectionListeners()
  }

  private registerPeerConnectionListeners() {
    this.peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log(
          `ICE gathering state changed: ${this.peerConnection.iceGatheringState}`);
    });
  
    this.peerConnection.addEventListener('connectionstatechange', () => {
      // TODO Handle disconection
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

  private collectCallerIceCandidates() {
    const callerCandidatesCollection = this.roomRef.collection('callerCandidates')
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final caller candidate!')
        return
      }
      console.log('Got caller candidate: ', event.candidate)
      callerCandidatesCollection.add(event.candidate.toJSON())
    })
  }

  private collectCalleeIceCandidates() {
    const calleeCandidatesCollection = this.roomRef.collection('calleeCandidates');
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
  }

  private setupCalleeIceCandidatesListening() {
    this.roomRef.collection('calleeCandidates').ref.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new callee remote ICE candidate: ${JSON.stringify(data)}`);
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  }
}
