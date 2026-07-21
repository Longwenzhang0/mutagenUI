package mutagen

import (
	"encoding/json"
	"testing"
)

func TestNormalizeUserSample(t *testing.T) {
	raw := `{"name":"business-console","identifier":"abc","paused":false,"status":"watching",
	"alpha":{"connected":true,"path":"/Users/dev/projects/example","protocol":"local",
	"scanProblems":[{"error":"invalid symbolic link: target is absolute","path":".venv/bin/python3"}]},
	"beta":{"connected":true,"host":"1.2.3.4","port":45395,"user":"u","path":"/home/u/p"}}`
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	s := normalize(m)
	if s.ProblemCount != 1 || len(s.Problems) != 1 {
		t.Fatalf("problems: count=%d len=%d", s.ProblemCount, len(s.Problems))
	}
	p := s.Problems[0]
	if p.Side != "alpha" || p.Kind != "scan" || p.Path != ".venv/bin/python3" {
		t.Fatalf("bad problem: %+v", p)
	}
	if s.BetaURL != "u@1.2.3.4:45395:/home/u/p" {
		t.Fatalf("beta url: %s", s.BetaURL)
	}
	t.Logf("OK: %+v", p)
}

func TestClassifyPrompt(t *testing.T) {
	cases := []struct {
		line   string
		masked bool
		prompt bool
	}{
		{"user4@1.2.3.4's password: ", true, true},
		{"Enter passphrase for key '/home/u/.ssh/id_ed25519': ", true, true},
		{"Are you sure you want to continue connecting (yes/no/[fingerprint])?", false, true},
		{"Are you sure you want to continue connecting (yes/no)? ", false, true},
		{"Please type 'yes', 'no' or the fingerprint: ", false, true},
		{"Creating session...", false, false},
		{"\x1b[25l\x1b[HConnecting to agent (POSIX)...\x1b[K", false, false},
	}
	for _, c := range cases {
		masked, prompt := classifyPrompt(c.line)
		if masked != c.masked || prompt != c.prompt {
			t.Fatalf("classifyPrompt(%q) = (%v,%v), want (%v,%v)", c.line, masked, prompt, c.masked, c.prompt)
		}
	}
}

func TestExtractConfig(t *testing.T) {
	cases := []string{
		// top-level layout
		`{"mode":"two-way-resolved","ignore":{"vcs":true,"paths":[".DS_Store","node_modules/"]}}`,
		// nested configuration layout
		`{"configuration":{"mode":"two-way-resolved","ignore":{"vcs":true,"paths":[".DS_Store","node_modules/"]}}}`,
	}
	for i, raw := range cases {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatal(err)
		}
		s := normalize(m)
		if s.Mode != "two-way-resolved" {
			t.Fatalf("case %d mode: %q", i, s.Mode)
		}
		if !s.IgnoreVCS {
			t.Fatalf("case %d ignoreVCS false", i)
		}
		if len(s.Ignores) != 2 || s.Ignores[1] != "node_modules/" {
			t.Fatalf("case %d ignores: %v", i, s.Ignores)
		}
	}
}
