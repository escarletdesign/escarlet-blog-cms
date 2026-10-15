export class CmsError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
    if (extra.code) this.code = extra.code
  }
}
