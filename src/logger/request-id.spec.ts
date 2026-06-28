import type { IncomingMessage, ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER, genReqId } from './request-id';

function mockReqRes(headerValue?: string): {
  req: IncomingMessage;
  res: ServerResponse;
  setHeader: jest.Mock;
} {
  const req = {
    headers: headerValue === undefined ? {} : { [REQUEST_ID_HEADER]: headerValue },
  } as unknown as IncomingMessage;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as ServerResponse;
  return { req, res, setHeader };
}

describe('genReqId', () => {
  it('reuses an incoming x-request-id header', () => {
    const { req, res, setHeader } = mockReqRes('incoming-123');
    expect(genReqId(req, res)).toBe('incoming-123');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'incoming-123');
  });

  it('generates a uuid when no header is present and writes it back', () => {
    const { req, res, setHeader } = mockReqRes();
    const id = genReqId(req, res);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, id);
  });
});
