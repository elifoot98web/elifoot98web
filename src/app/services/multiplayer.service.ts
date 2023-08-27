import { Injectable } from '@angular/core';
import { GameHostingInfo } from '../models/hostInfo';
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
  
  constructor(private afStore: AngularFirestore) {}

  // This code is based on https://github.com/webrtc/FirebaseRTC

  async createRoom(hostInfo: GameHostingInfo, canvasStream: MediaStream, onConnectionStateChange: (event: RTCPeerConnectionState) => void) {
    const roomId: string = this.uidGenerator()
    
    this.roomRef = await this.afStore.collection('rooms').doc<GameRoom>(roomId)
    
    // Setup peer connection
    this.setupConnection(onConnectionStateChange)
    
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

  private setupConnection(connectionStateChangeListener: (connectionState: RTCPeerConnectionState) => void = () => {}) {
    const config = {
      iceServers: [
        {
          urls: environment.multiplayer.iceServers,
        },
        {
          urls: "stun:stun.relay.metered.ca:80",
        },
        {
          urls: "turn:a.relay.metered.ca:80",
          username: "631c75ecc434a6d0a9c26c92",
          credential: "8hamzirIerfjeAXw",
        },
        {
          urls: "turn:a.relay.metered.ca:80?transport=tcp",
          username: "631c75ecc434a6d0a9c26c92",
          credential: "8hamzirIerfjeAXw",
        },
        {
          urls: "turn:a.relay.metered.ca:443",
          username: "631c75ecc434a6d0a9c26c92",
          credential: "8hamzirIerfjeAXw",
        },
        {
          urls: "turn:a.relay.metered.ca:443?transport=tcp",
          username: "631c75ecc434a6d0a9c26c92",
          credential: "8hamzirIerfjeAXw",
        },
      ],
      iceCandidatePoolSize: environment.multiplayer.iceCandidatePoolSize,
    }
    this.peerConnection = new RTCPeerConnection(config)
    console.log("Peer Connection Created with config:", {peerConnection: this.peerConnection, config})
    this.registerPeerConnectionListeners(connectionStateChangeListener)
  }

  private registerPeerConnectionListeners(connectionStateChangeListener: (connectionState: RTCPeerConnectionState) => void = () => {}) {
    this.peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log(
          `ICE gathering state changed: ${this.peerConnection.iceGatheringState}`);
    });
  
    this.peerConnection.addEventListener('connectionstatechange', () => {
      // TODO Handle disconection
      connectionStateChangeListener(this.peerConnection.connectionState)
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

  /**
   * Collecting caller ICE candidates
   * This code is used by the host(caller) to collect its own ICE candidates from the STUN servers
   *  */ 
  private collectCallerIceCandidates() {
    const callerCandidatesCollection = this.roomRef.collection('callerCandidates')
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final caller candidate!')
        return
      }
      callerCandidatesCollection.add(event.candidate.toJSON())
    })
  }

    /**
   * Collecting callee ICE candidates
   * This code is used by the guest(callee) to collect its own ICE candidates from the STUN servers
   *  */ 
  private collectCalleeIceCandidates() {
    const calleeCandidatesCollection = this.roomRef.collection('calleeCandidates');
    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final callee candidate!');
        return;
      }
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
  }

  /**
   * Listening for remote ICE candidates
   * This code is used by the host(caller) to listen for remote ICE candidates sent by the guest(callee)
   */
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
