// Domain error carrying an HTTP status. Thrown by the service layer, mapped to
// a response by the route error handler / socket ack. Lives here (not in a
// service) so connectionAccess and the services can share it without a cycle.
export class ConnectionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
