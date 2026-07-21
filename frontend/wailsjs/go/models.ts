export namespace config {
	
	export class Group {
	    name: string;
	    collapsed: boolean;
	    sessions: string[];
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.collapsed = source["collapsed"];
	        this.sessions = source["sessions"];
	    }
	}
	export class Layout {
	    sortMode: string;
	    groups: Group[];
	    ungrouped: string[];
	
	    static createFrom(source: any = {}) {
	        return new Layout(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sortMode = source["sortMode"];
	        this.groups = this.convertValues(source["groups"], Group);
	        this.ungrouped = source["ungrouped"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Preset {
	    name: string;
	    alpha: string;
	    beta: string;
	    mode: string;
	    ignoreVCS: boolean;
	    ignores: string[];
	
	    static createFrom(source: any = {}) {
	        return new Preset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.alpha = source["alpha"];
	        this.beta = source["beta"];
	        this.mode = source["mode"];
	        this.ignoreVCS = source["ignoreVCS"];
	        this.ignores = source["ignores"];
	    }
	}
	export class Config {
	    mutagenPath: string;
	    presets: Preset[];
	    layout: Layout;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mutagenPath = source["mutagenPath"];
	        this.presets = this.convertValues(source["presets"], Preset);
	        this.layout = this.convertValues(source["layout"], Layout);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	

}

export namespace main {
	
	export class ImageBlob {
	    name: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new ImageBlob(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.data = source["data"];
	    }
	}
	export class MutagenInfo {
	    ok: boolean;
	    path: string;
	    version: string;
	    bundled: boolean;
	    error: string;
	    debugLog: string;
	
	    static createFrom(source: any = {}) {
	        return new MutagenInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.path = source["path"];
	        this.version = source["version"];
	        this.bundled = source["bundled"];
	        this.error = source["error"];
	        this.debugLog = source["debugLog"];
	    }
	}
	export class SentImage {
	    name: string;
	    remoteAbs: string;
	    remoteRel: string;
	
	    static createFrom(source: any = {}) {
	        return new SentImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.remoteAbs = source["remoteAbs"];
	        this.remoteRel = source["remoteRel"];
	    }
	}

}

export namespace mutagen {
	
	export class CreateSpec {
	    name: string;
	    alpha: string;
	    beta: string;
	    mode: string;
	    ignoreVCS: boolean;
	    ignores: string[];
	
	    static createFrom(source: any = {}) {
	        return new CreateSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.alpha = source["alpha"];
	        this.beta = source["beta"];
	        this.mode = source["mode"];
	        this.ignoreVCS = source["ignoreVCS"];
	        this.ignores = source["ignores"];
	    }
	}
	export class Problem {
	    side: string;
	    kind: string;
	    path: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new Problem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.side = source["side"];
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.error = source["error"];
	    }
	}
	export class Session {
	    identifier: string;
	    name: string;
	    paused: boolean;
	    status: string;
	    alphaUrl: string;
	    betaUrl: string;
	    alphaConnected: boolean;
	    betaConnected: boolean;
	    alphaPath: string;
	    betaPath: string;
	    alphaLocal: boolean;
	    mode: string;
	    ignoreVCS: boolean;
	    ignores: string[];
	    conflictCount: number;
	    problemCount: number;
	    problems: Problem[];
	    conflicts: string[];
	    lastError: string;
	    raw: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.identifier = source["identifier"];
	        this.name = source["name"];
	        this.paused = source["paused"];
	        this.status = source["status"];
	        this.alphaUrl = source["alphaUrl"];
	        this.betaUrl = source["betaUrl"];
	        this.alphaConnected = source["alphaConnected"];
	        this.betaConnected = source["betaConnected"];
	        this.alphaPath = source["alphaPath"];
	        this.betaPath = source["betaPath"];
	        this.alphaLocal = source["alphaLocal"];
	        this.mode = source["mode"];
	        this.ignoreVCS = source["ignoreVCS"];
	        this.ignores = source["ignores"];
	        this.conflictCount = source["conflictCount"];
	        this.problemCount = source["problemCount"];
	        this.problems = this.convertValues(source["problems"], Problem);
	        this.conflicts = source["conflicts"];
	        this.lastError = source["lastError"];
	        this.raw = source["raw"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

