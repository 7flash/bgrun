import { dlopen, FFIType } from "bun:ffi";
const api = dlopen("kernel32.dll", {
  WaitForSingleObject: {
    args: [FFIType.u64, FFIType.u32],
    returns: FFIType.u32,
  },
});
const result = api.symbols.WaitForSingleObject(
  BigInt(process.env.BGR_TEST_HANDLE!),
  0,
);
console.log(JSON.stringify({ result }));
api.close();