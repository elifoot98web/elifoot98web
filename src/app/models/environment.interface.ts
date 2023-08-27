export interface AppEnvironment {
    recaptchaSiteKey: string;
    firebase: {
        apiKey: string;
        authDomain: string;
        projectId: string;
        storageBucket: string;
        messagingSenderId: string;
        appId: string;
        measurementId: string;
    };
    production: boolean;
    multiplayer: {
        iceServers: string[]
        iceCandidatePoolSize: number
    }
}