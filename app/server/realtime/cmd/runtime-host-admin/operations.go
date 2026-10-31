package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/hostops"
)

func runOperation(args []string) (bool, error) {
	if len(args) == 0 {
		return false, nil
	}
	switch args[0] {
	case "release", "prepare-funnel", "setup-updater", "serve-funnel", "update", "funnel-hostname", "funnel-vacant":
	default:
		return false, nil
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return true, executeOperation(ctx, args[0], args[1:])
}

func executeOperation(ctx context.Context, command string, args []string) error {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	switch command {
	case "release":
		root := flags.String("root", "", "absolute repository directory")
		if err := flags.Parse(args); err != nil {
			return err
		}
		if flags.NArg() != 2 {
			return errors.New("usage: release --root /repository /new-output commit-sha")
		}
		return hostops.PackageRelease(ctx, hostops.ReleaseOptions{Root: *root, Output: flags.Arg(0), SHA: flags.Arg(1)})
	case "prepare-funnel":
		root := flags.String("root", "", "absolute repository directory")
		if err := flags.Parse(args); err != nil {
			return err
		}
		if flags.NArg() < 2 || flags.NArg() > 4 || !filepath.IsAbs(*root) {
			return errors.New("usage: prepare-funnel --root /repository /new-output user [/release [/environment]]")
		}
		return hostops.PrepareFunnel(ctx, hostops.FunnelOptions{Root: *root, Output: flags.Arg(0), User: flags.Arg(1), Release: flags.Arg(2), EnvFile: flags.Arg(3)})
	case "setup-updater":
		install := len(args) > 0 && args[len(args)-1] == "--install"
		if install {
			args = args[:len(args)-1]
		}
		if len(args) > 2 {
			return errors.New("usage: setup-updater [/new-output [/Funnel]] [--install]")
		}
		for _, arg := range args {
			if !filepath.IsAbs(arg) {
				return errors.New("updater paths must be absolute")
			}
		}
		options := hostops.SetupOptions{Install: install}
		if len(args) > 0 {
			options.Output = args[0]
		}
		if len(args) > 1 {
			options.DeploymentDirectory = args[1]
		}
		return hostops.SetupUpdater(ctx, options)
	case "serve-funnel", "update":
		configPath := flags.String("config", "", "absolute config path")
		var force, check bool
		if command == "update" {
			flags.BoolVar(&force, "force", false, "update even when activity is unknown or nonzero")
			flags.BoolVar(&check, "check", false, "only discover an available release")
		}
		if err := flags.Parse(args); err != nil {
			return err
		}
		if flags.NArg() != 0 || !filepath.IsAbs(*configPath) || (force && check) {
			return errors.New("an absolute --config path and valid options are required")
		}
		if command == "serve-funnel" {
			config, err := hostops.LoadFunnelConfig(*configPath)
			if err != nil {
				return errors.New("cannot load Funnel configuration")
			}
			return hostops.ServeFunnel(ctx, config)
		}
		config, err := hostops.LoadUpdateConfig(*configPath)
		if err != nil {
			return errors.New("cannot load updater configuration")
		}
		result, err := hostops.Update(ctx, config, hostops.UpdateOptions{Force: force, Check: check})
		if err != nil {
			return errors.New("runtime host update failed: invalid configuration or unavailable local files")
		}
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			return err
		}
		if result.Status == "failed" {
			return errors.New("runtime host update failed")
		}
		return nil
	case "funnel-hostname", "funnel-vacant":
		if len(args) != 0 {
			return errors.New("funnel JSON commands do not accept arguments")
		}
		data, err := io.ReadAll(io.LimitReader(os.Stdin, 1024*1024+1))
		if err != nil || len(data) > 1024*1024 {
			return errors.New("cannot read Funnel status")
		}
		if command == "funnel-vacant" {
			return hostops.CheckFunnelVacant(data)
		}
		hostname, err := hostops.FunnelHostname(data)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintln(os.Stdout, hostname)
		return err
	default:
		return errors.New("unknown runtime host operation")
	}
}
