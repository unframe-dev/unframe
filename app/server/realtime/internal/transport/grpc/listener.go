package grpc

import (
	"bufio"
	"net"
	"sync"
	"time"
)

// splitListener keeps gRPC on its native HTTP/2 transport, including its drain
// semantics, while HTTP/1 upgrades reach the browser adapter on the same port.
type splitListener struct {
	net.Listener
	grpc     chan net.Conn
	http     chan net.Conn
	httpDone chan struct{}
	httpOnce sync.Once
	done     chan struct{}
	once     sync.Once
}

func newSplitListener(base net.Listener) *splitListener {
	return &splitListener{Listener: base, grpc: make(chan net.Conn), http: make(chan net.Conn), done: make(chan struct{}), httpDone: make(chan struct{})}
}
func (s *splitListener) run() {
	for {
		conn, err := s.Listener.Accept()
		if err != nil {
			_ = s.Close()
			return
		}
		go s.route(conn)
	}
}
func (s *splitListener) route(conn net.Conn) {
	finished, watchDone := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(watchDone)
		select {
		case <-s.done:
			_ = conn.Close()
		case <-finished:
		}
	}()

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	prefix, err := reader.Peek(3)
	close(finished)
	<-watchDone
	if err != nil {
		_ = conn.Close()
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	target := s.http
	var targetDone <-chan struct{} = s.httpDone
	if string(prefix) == "PRI" {
		target = s.grpc
		targetDone = nil
	}
	select {
	case target <- &bufferedConn{Conn: conn, reader: reader}:
	case <-s.done:
		_ = conn.Close()
	case <-targetDone:
		_ = conn.Close()
	}
}
func (s *splitListener) Close() error {
	var err error
	s.once.Do(func() { err = s.Listener.Close(); close(s.done) })
	return err
}
func (s *splitListener) Accept() (net.Conn, error) { return s.accept(s.grpc) }
func (s *splitListener) accept(channel <-chan net.Conn) (net.Conn, error) {
	select {
	case conn := <-channel:
		return conn, nil
	case <-s.done:
		return nil, net.ErrClosed
	}
}

type httpListener struct{ *splitListener }

func (s httpListener) Accept() (net.Conn, error) {
	select {
	case conn := <-s.http:
		return conn, nil
	case <-s.done:
		return nil, net.ErrClosed
	case <-s.httpDone:
		return nil, net.ErrClosed
	}
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

func (s httpListener) Close() error { s.httpOnce.Do(func() { close(s.httpDone) }); return nil }
