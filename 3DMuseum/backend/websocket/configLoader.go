package websocket

import (
	"fmt"
	"os"

	"github.com/pelletier/go-toml/v2"
)

type ICEConfig struct {
	Servers []ICEServer `toml:"servers"`
}

type ICEServer struct {
	URLs       []string `toml:"urls"`
	Username   string   `toml:"username"`
	Credential string   `toml:"credential"`
}

type RTCConfig struct {
	ICEServers ICEConfig `toml:"ice_servers"`
}

type SFUConfig struct {
	RTC RTCConfig `toml:"rtc"`
}

// LoadSFUConfig loads config.toml into SFUConfig struct.
func LoadSFUConfig(path string) (*SFUConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	var cfg SFUConfig
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal toml: %w", err)
	}
	return &cfg, nil
}
