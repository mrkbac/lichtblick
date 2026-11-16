@0xd6c1b4a3e2f10987;

enum Color { red @0; green @1; blue @2; }

struct Point { x @0 :Float64; y @1 :Float64; }

struct All {
  b @0 :Bool;
  i8 @1 :Int8;
  i16 @2 :Int16;
  i32 @3 :Int32;
  i64 @4 :Int64;
  u8 @5 :UInt8;
  u16 @6 :UInt16;
  u32 @7 :UInt32;
  u64 @8 :UInt64;
  f32 @9 :Float32;
  f64 @10 :Float64;
  text @11 :Text;
  data @12 :Data;
  color @13 :Color;
  point @14 :Point;
  points @15 :List(Point);
  floats @16 :List(Float32);
  bools @17 :List(Bool);
  texts @18 :List(Text);
  nested @19 :List(List(Int32));
  colors @20 :List(Color);
  defI32 @21 :Int32 = 42;
  defF64 @22 :Float64 = 1.5;
  defB @23 :Bool = true;
  defText @24 :Text = "hello";
  nothing @25 :Void;
  union {
    none @26 :Void;
    num @27 :UInt32;
    word @28 :Text;
  }
  grp :group {
    a @29 :Int16;
    b @30 :Text;
  }
  shape :union {
    circle @31 :Float32;
    square @32 :Point;
  }
  i64s @33 :List(Int64);
  u8s @34 :List(UInt8);
  defColor @35 :Color = blue;
  datas @36 :List(Data);
  self @37 :All;
}

struct Amp { items @0 :List(Data); }
