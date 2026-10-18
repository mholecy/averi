#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// The lab's state file (scripts/truth/schema.ts#LabState), `Documents/lab-state.json` in the app's data container —
// read by the capture script and the live golden (scripts/truth/lab-device.ts#IosLab.state), as the SwiftUI lab app's
// (fixtures/apps/ios/AveriLab/Lab.swift). The JS model (src/lab.ts) hands its whole state over on every change
// (`write`); this side keeps the touch log — every touch any window of the app receives, before anything handles it
// (UIApplication.sendEvent, swapped once at load: the keyboard's host window is the app's too, as in Lab.swift's
// TouchRecorder) — and writes the two merged, the events in time order, whole and atomically.

@interface LabStateStore : NSObject
+ (instancetype)shared;
- (void)write:(NSString *)json;
- (void)touched:(CGPoint)point;
@end

@implementation LabStateStore {
  NSDictionary *_snapshot;
  NSMutableArray<NSDictionary *> *_touches;
  NSURL *_file;
  dispatch_queue_t _queue;
}

+ (instancetype)shared
{
  static LabStateStore *store;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    store = [LabStateStore new];
  });
  return store;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _touches = [NSMutableArray new];
    NSURL *documents = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    _file = [documents URLByAppendingPathComponent:@"lab-state.json"];
    _queue = dispatch_queue_create("dev.averi.lab.rn.state", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)write:(NSString *)json
{
  NSDictionary *snapshot = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![snapshot isKindOfClass:NSDictionary.class]) return;
  dispatch_async(_queue, ^{
    self->_snapshot = snapshot;
    [self flush];
  });
}

- (void)touched:(CGPoint)point
{
  NSDictionary *event = @{
    @"kind" : @"touch",
    @"tag" : [NSString stringWithFormat:@"%.1f,%.1f", point.x, point.y],
    @"at" : @(NSDate.date.timeIntervalSince1970),
  };
  dispatch_async(_queue, ^{
    [self->_touches addObject:event];
    [self flush];
  });
}

/** Nothing before the model's first state: a touch then is kept and written with it. */
- (void)flush
{
  if (_snapshot == nil) return;
  NSMutableDictionary *state = [_snapshot mutableCopy];
  NSMutableArray *events = [NSMutableArray arrayWithArray:state[@"events"] ?: @[]];
  [events addObjectsFromArray:_touches];
  [events sortWithOptions:NSSortStable usingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [a[@"at"] compare:b[@"at"]];
  }];
  state[@"events"] = events;
  NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
  [data writeToURL:_file options:NSDataWritingAtomic error:nil];
}

@end

/** The JS model's way to the file: `NativeModules.LabStateFile.write(json)`. */
@interface LabStateFile : NSObject <RCTBridgeModule>
@end

@implementation LabStateFile

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(write : (NSString *)json)
{
  [LabStateStore.shared write:json];
}

@end

@implementation UIApplication (LabTouches)

+ (void)load
{
  Method original = class_getInstanceMethod(self, @selector(sendEvent:));
  Method recording = class_getInstanceMethod(self, @selector(lab_sendEvent:));
  method_exchangeImplementations(original, recording);
}

/** After load this IS sendEvent:, and `lab_sendEvent:` the original. */
- (void)lab_sendEvent:(UIEvent *)event
{
  if (event.type == UIEventTypeTouches) {
    for (UITouch *touch in event.allTouches) {
      if (touch.phase != UITouchPhaseBegan || touch.window == nil) continue;
      UIWindow *window = touch.window;
      [LabStateStore.shared touched:[window convertPoint:[touch locationInView:window] toCoordinateSpace:window.screen.coordinateSpace]];
    }
  }
  [self lab_sendEvent:event];
}

@end
