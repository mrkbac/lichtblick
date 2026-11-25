// Test fixture: a Foxglove-style data loader for a tiny text format.
// Each line: `<log_time_ns> <topic> <json>`. Messages are JSON with a jsonschema schema.
use foxglove_data_loader::{
    console, reader, BackfillArgs, DataLoader, DataLoaderArgs, Initialization, Message,
    MessageIterator, MessageIteratorArgs, Problem, TimeRange,
};
use std::io::Read;

foxglove_data_loader::export!(TextLoader);

struct Row {
    time: u64,
    channel: u16,
    data: Vec<u8>,
}

struct TextLoader {
    paths: Vec<String>,
    rows: Vec<Row>,
}

impl DataLoader for TextLoader {
    type MessageIterator = TextIterator;
    type Error = anyhow::Error;

    fn new(args: DataLoaderArgs) -> Self {
        Self { paths: args.paths, rows: Vec::new() }
    }

    fn initialize(&mut self) -> Result<Initialization, Self::Error> {
        let mut topics: Vec<String> = Vec::new();
        let mut problems = Vec::new();
        for path in &self.paths {
            let mut text = String::new();
            reader::open(path).read_to_string(&mut text)?;
            for (i, line) in text.lines().enumerate() {
                let mut parts = line.splitn(3, ' ');
                let (Some(t), Some(topic), Some(json)) = (parts.next(), parts.next(), parts.next())
                else {
                    problems.push(Problem::warn(format!("{path}:{}: malformed line", i + 1)));
                    continue;
                };
                let time: u64 = t.parse()?;
                let channel = match topics.iter().position(|x| x == topic) {
                    Some(idx) => idx,
                    None => {
                        topics.push(topic.to_string());
                        topics.len() - 1
                    }
                } as u16 + 1;
                self.rows.push(Row { time, channel, data: json.as_bytes().to_vec() });
            }
        }
        self.rows.sort_by_key(|r| r.time);
        console::log(&format!("loaded {} rows", self.rows.len()));
        let mut init = Initialization::builder()
            .time_range(TimeRange {
                start_time: self.rows.first().map_or(0, |r| r.time),
                end_time: self.rows.last().map_or(0, |r| r.time),
            });
        for problem in problems {
            init = init.add_problem(problem);
        }
        let schema = init.add_schema_with_id(
            1,
            foxglove::Schema::new("test.Value", "jsonschema", br#"{"type":"object"}"#.to_vec()),
        ).expect("schema id");
        for (idx, topic) in topics.iter().enumerate() {
            let count = self.rows.iter().filter(|r| r.channel == idx as u16 + 1).count();
            schema
                .add_channel_with_id(idx as u16 + 1, topic)
                .expect("channel id")
                .message_encoding("json")
                .message_count(count as u64);
        }
        Ok(init.build())
    }

    fn create_iter(&mut self, args: MessageIteratorArgs) -> Result<TextIterator, Self::Error> {
        let messages = self
            .rows
            .iter()
            .filter(|r| {
                args.channels.contains(&r.channel)
                    && args.start_time.is_none_or(|s| r.time >= s)
                    && args.end_time.is_none_or(|e| r.time <= e)
            })
            .map(|r| to_message(r))
            .collect::<Vec<_>>();
        Ok(TextIterator { messages: messages.into_iter() })
    }

    fn get_backfill(&mut self, args: BackfillArgs) -> Result<Vec<Message>, Self::Error> {
        Ok(args
            .channels
            .iter()
            .filter_map(|c| self.rows.iter().rev().find(|r| r.channel == *c && r.time <= args.time))
            .map(to_message)
            .collect())
    }
}

fn to_message(r: &Row) -> Message {
    Message { channel_id: r.channel, log_time: r.time, publish_time: r.time, data: r.data.clone() }
}

struct TextIterator {
    messages: std::vec::IntoIter<Message>,
}

impl MessageIterator for TextIterator {
    type Error = anyhow::Error;
    fn next(&mut self) -> Option<Result<Message, Self::Error>> {
        self.messages.next().map(Ok)
    }
}
